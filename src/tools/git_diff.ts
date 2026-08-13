import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { GIT_DIFF_TOOL_DEFINITION } from "../tool_definitions/git_diff.ts";
import { resolveSandboxPath, isEntrySandboxSafe } from "../sandbox.ts";

const execFile = promisify(execFileCb);

// Ceiling on raw git output before our own line/byte truncation (below) applies — generous enough
// that a large but reasonable diff isn't rejected outright by Node's stdout buffering.
const MAX_BUFFER = 20 * 1024 * 1024; // 20MB

// Same caps as `read`'s DEFAULT_MAX_LINES/DEFAULT_MAX_BYTES, applied here for the same reason: one
// call shouldn't be able to flood a small model's context with an enormous diff.
const DEFAULT_MAX_LINES = 2000;
const DEFAULT_MAX_BYTES = 50 * 1024; // 50KB

export interface GitDiffOptions {
  /** Path (relative to `cwd`) to scope the diff to. Omit for the whole repository. */
  path?: string;
  signal?: AbortSignal;
}

export interface GitDiffResult {
  text: string;
  truncated: boolean;
}

// Matches the "diff --git a/<path> b/<path>" line git prints at the start of each file's section —
// the boundary `filterRestrictedDiffChunks` splits on. Doesn't attempt to un-escape quoted paths
// (core.quotepath's handling of spaces/unicode/etc.) — same level of pragmatic parsing `gitStatus`
// already applies to its own "-> " rename-arrow splitting.
const DIFF_FILE_HEADER_RE = /^diff --git a\/(.+) b\/(.+)$/;

/**
 * Splits `diffText` into per-file sections on its `diff --git a/<path> b/<path>` headers and drops
 * any section whose old or new path matches the sandbox's read-restricted globs — `git diff`, unlike
 * `find`/`grep`/`list`, never runs its results through `isEntrySandboxSafe` on its own (it isn't
 * walking the filesystem, it's parsing subprocess output), so a credential-shaped file
 * (`.env`, `.ssh/**`, ...) that's tracked in git and has an uncommitted change would otherwise have
 * its full diff — not just its path — disclosed by an ordinary, unscoped `git_diff` call. Checked
 * against both the old and new path since a rename can move a file into (or out of) a restricted
 * path even when neither endpoint alone looks that way from the other side.
 *
 * Falls back to returning `diffText` untouched if it doesn't start with a recognizable header at
 * all (e.g. a future git version changes the format) — this is a best-effort filter layered on top
 * of subprocess text, not a hard containment boundary the way `resolveSandboxPath` is for the
 * filesystem-walking tools, so failing open to "unfiltered" here is preferable to failing the whole
 * call over output we don't recognize.
 */
function filterRestrictedDiffChunks(cwd: string, diffText: string): string {
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
    const restricted =
      !isEntrySandboxSafe(cwd, aPath!, "read", false) || !isEntrySandboxSafe(cwd, bPath!, "read", false);
    if (!restricted) kept.push(...lines.slice(start, end));
  }
  return kept.join("\n");
}

/**
 * Runs `git diff` (unstaged changes only) in `cwd` and returns the unified diff text, capped at
 * DEFAULT_MAX_LINES lines / DEFAULT_MAX_BYTES bytes (whichever is hit first) — the same shape of
 * cap `readFile` applies to file contents.
 */
export async function gitDiff(cwd: string, opts: GitDiffOptions = {}): Promise<GitDiffResult> {
  const args = ["diff"];
  if (opts.path) args.push("--", opts.path);

  let stdout: string;
  try {
    ({ stdout } = await execFile("git", args, { cwd, signal: opts.signal, maxBuffer: MAX_BUFFER }));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).name === "AbortError") throw err;
    throw new Error(`git diff failed: ${describeError(err)}`);
  }

  if (stdout === "") return { text: "", truncated: false };

  const filtered = filterRestrictedDiffChunks(cwd, stdout);
  if (filtered === "") return { text: "", truncated: false };

  const allLines = filtered.split(/\r\n|\n/);
  let selected = allLines.slice(0, Math.min(allLines.length, DEFAULT_MAX_LINES));
  while (selected.length > 1 && Buffer.byteLength(selected.join("\n"), "utf8") > DEFAULT_MAX_BYTES) {
    selected = selected.slice(0, -1);
  }

  return { text: selected.join("\n"), truncated: selected.length < allLines.length };
}

function describeError(err: unknown): string {
  const e = err as NodeJS.ErrnoException & { stderr?: string };
  if (e.code === "ENOENT") return "git is not installed or not on PATH";
  return e.stderr?.trim() || e.message || String(err);
}

export function registerGitDiffTool(pi: ExtensionAPI) {
  pi.registerTool({
    ...GIT_DIFF_TOOL_DEFINITION,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      let relPath: string | undefined;
      if (params.path) {
        const resolved = resolveSandboxPath(ctx.cwd, params.path, "read");
        const rel = path.relative(ctx.cwd, resolved);
        relPath = rel === "" ? undefined : rel;
      }

      const result = await gitDiff(ctx.cwd, { path: relPath, signal });

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
