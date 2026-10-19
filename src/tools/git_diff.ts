import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";
import { GIT_DIFF_TOOL_DEFINITION } from "../tool_definitions/git_diff.ts";
import type { ToolRegistry } from "../sandbox/permissionGate.ts";
import { sandboxFor, type Sandbox } from "../sandbox/sandbox.ts";
import { oneLine, callName } from "../backend/renderCall.ts";
import { withConciseValidationErrors } from "../backend/toolValidation.ts";

const execFile = promisify(execFileCb);

// Ceiling on raw git output before our own line/byte truncation (below) applies — generous enough
// that a large but reasonable diff isn't rejected outright by Node's stdout buffering.
const MAX_BUFFER = 20 * 1024 * 1024; // 20MB

// Same caps as `read`'s MAX_READ_LINES/MAX_READ_BYTES, applied here for the same reason: one
// call shouldn't be able to flood a small model's context with an enormous diff.
const MAX_READ_LINES = 2000;
const MAX_READ_BYTES = 50 * 1024; // 50KB

export interface GitDiffOptions {
  /** Path (resolved through the sandbox) to scope the diff to. Omit for the whole repository. */
  path?: string;
  signal?: AbortSignal;
}

export interface GitDiffResult {
  text: string;
  truncated: boolean;
}

// Matches the "diff --git a/<path> b/<path>" line git prints at the start of each file's section —
// the boundary `filterRestrictedDiffChunks` splits on. Also handles mnemonicPrefix mode which uses
// "i/" and "w/" instead of "a/" and "b/". Doesn't attempt to un-escape quoted paths
// (core.quotepath's handling of spaces/unicode/etc.) — same level of pragmatic parsing `gitStatus`
// already applies to its own "-> " rename-arrow splitting.
const DIFF_FILE_HEADER_RE = /^diff --git [ai]\/(.+) [bw]\/(.+)$/;

/**
 * Splits `diffText` into per-file sections on its `diff --git a/<path> b/<path>` headers and drops
 * any section whose old or new path the sandbox protects (`sb.allowsReported`). git reports what it
 * knows, not what the sandbox allows, so a credential-shaped file
 * (`.env`, `.ssh/**`, ...) that's tracked in git and has an uncommitted change would otherwise have
 * its full diff — not just its path — disclosed by an ordinary, unscoped `git_diff` call. Checked
 * against both the old and new path since a rename can move a file into (or out of) a restricted
 * path even when neither endpoint alone looks that way from the other side.
 *
 * Falls back to returning `diffText` untouched if it doesn't start with a recognizable header at
 * all (e.g. a future git version changes the format) — this is a best-effort filter layered on top
 * of subprocess text, not a hard containment boundary the way `Sandbox.resolve` is for
 * filesystem paths, so failing open to "unfiltered" here is preferable to failing the whole
 * call over output we don't recognize.
 */
async function filterRestrictedDiffChunks(sb: Sandbox, diffText: string, gitToSandboxRelative: string): Promise<string> {
  const lines = diffText.split(/\r\n|\n/);
  const chunkStarts: number[] = [];
  lines.forEach((line, i) => {
    if (DIFF_FILE_HEADER_RE.test(line)) chunkStarts.push(i);
  });
  if (chunkStarts.length === 0) return diffText;

  const kept: string[] = [];
  for (let c = 0; c < chunkStarts.length; c++) {
    const start = chunkStarts[c]!;
    const end = c + 1 < chunkStarts.length ? chunkStarts[c + 1]! : lines.length;
    const [, aPath, bPath] = lines[start]!.match(DIFF_FILE_HEADER_RE)!;
    
    // Check if paths are within sandbox root
    const aInSandbox = aPath.startsWith(gitToSandboxRelative) || 
                       path.relative(gitToSandboxRelative, aPath).startsWith("..");
    const bInSandbox = bPath.startsWith(gitToSandboxRelative) || 
                       path.relative(gitToSandboxRelative, bPath).startsWith("..");
    
    if (!aInSandbox || !bInSandbox) {
      continue;
    }
    
    // Convert to sandbox-relative paths for allowsReported check
    const sandboxRelativeA = path.relative(gitToSandboxRelative, aPath);
    const sandboxRelativeB = path.relative(gitToSandboxRelative, bPath);
    
    if (sb.allowsReported(sandboxRelativeA) && sb.allowsReported(sandboxRelativeB)) {
      kept.push(...lines.slice(start, end));
    }
  }
  return kept.join("\n");
}

/**
 * Runs `git diff` (unstaged changes only) in `cwd` and returns the unified diff text, capped at
 * MAX_READ_LINES lines / MAX_READ_BYTES bytes (whichever is hit first) — the same shape of
 * cap `readFile` applies to file contents.
 */
export async function gitDiff(sb: Sandbox, opts: GitDiffOptions = {}): Promise<GitDiffResult> {
  const args = ["diff"];
  const scope = opts.path ? sb.relative(opts.path) : ".";
  args.push("--", scope);

  let stdout: string;
  try {
    ({ stdout } = await execFile("git", args, { cwd: sb.root, signal: opts.signal, maxBuffer: MAX_BUFFER }));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).name === "AbortError") throw err;
    throw new TypeError(`git diff failed: ${describeError(err)}`);
  }

  if (stdout === "") return { text: "", truncated: false };

  // Get the relative path from git root to sandbox root
  let gitToSandboxRelative: string;
  try {
    const gitRoot = await execFile("git", ["rev-parse", "--show-toplevel"], { cwd: sb.root, signal: opts.signal });
    gitToSandboxRelative = path.relative(gitRoot.stdout.trim(), sb.root);
  } catch {
    // If we can't determine git root, fall back to filtering by sandbox allowsReported only
    gitToSandboxRelative = ".";
  }

  const filtered = await filterRestrictedDiffChunks(sb, stdout, gitToSandboxRelative);
  if (filtered === "") return { text: "", truncated: false };

  const allLines = filtered.split(/\r\n|\n/);
  let selected = allLines.slice(0, Math.min(allLines.length, MAX_READ_LINES));
  while (selected.length > 1 && Buffer.byteLength(selected.join("\n"), "utf8") > MAX_READ_BYTES) {
    selected = selected.slice(0, -1);
  }

  return { text: selected.join("\n"), truncated: selected.length < allLines.length };
}

function describeError(err: unknown): string {
  const e = err as NodeJS.ErrnoException & { stderr?: string };
  if (e.code === "ENOENT") return "git is not installed or not on PATH";
  return e.stderr?.trim() || e.message || String(err);
}

export function registerGitDiffTool(pi: ToolRegistry) {
  pi.registerTool({
    ...GIT_DIFF_TOOL_DEFINITION,
    prepareArguments: withConciseValidationErrors(GIT_DIFF_TOOL_DEFINITION.name, GIT_DIFF_TOOL_DEFINITION.parameters),
    renderCall(args, theme) {
      const text = callName(theme, "git_diff");
      return oneLine(args.path ? text + theme.fg("toolOutput", ` ${args.path}`) : text);
    },
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const result = await gitDiff(sandboxFor(ctx.cwd), { path: params.path, signal });

      let text = result.text || "No changes.";
      if (result.truncated) {
        text += `\n\n[Diff truncated. Narrow with path to see less at once, e.g. { path: "<subdirectory>" }.]`;
      }

      return {
        content: [{ type: "text", text }],
        details: { truncated: result.truncated },
      };
    },
  });
}
