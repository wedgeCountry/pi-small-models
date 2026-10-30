import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { GIT_DIFF_TOOL_DEFINITION } from "../tool_definitions/git_diff.ts";
import type { ToolRegistry } from "../sandbox/permissionGate.ts";
import { sandboxFor, type Sandbox } from "../sandbox/sandbox.ts";
import { oneLine, callName } from "../backend/renderCall.ts";
import { withConciseValidationErrors } from "../backend/toolValidation.ts";
import { toolError } from "../backend/formatError.ts";
import { escapeTripleBackticks } from "../backend/escapeBackticks.ts";

const execFile = promisify(execFileCb);

// Ceiling on raw git output before our own line/byte truncation (below) applies — generous enough
// that a large but reasonable diff isn't rejected outright by Node's stdout buffering.
const MAX_BUFFER = 20 * 1024 * 1024; // 20MB

// Same caps as `read`'s DEFAULT_MAX_LINES/DEFAULT_MAX_BYTES, applied here for the same reason: one
// call shouldn't be able to flood a small model's context with an enormous diff.
const DEFAULT_MAX_LINES = 2000;
const DEFAULT_MAX_BYTES = 50 * 1024; // 50KB

export interface GitDiffOptions {
  /** Path (resolved through the sandbox) to scope the diff to. Omit for the whole repository. */
  path?: string;
  /**
   * Pass git's `--name-only`: report just the changed paths, one per line, with no diff body.
   * Handy for a weak model as a cheap "what changed?" step before pulling a full diff into context.
   */
  nameOnly?: boolean;
  signal?: AbortSignal;
}

export interface GitDiffResult {
  text: string;
  truncated: boolean;
  /**
   * True when the repository has no commit yet, so `git diff HEAD` has no baseline to compare
   * against. Distinct from `text: ""`, which means "compared, found nothing different" — telling the
   * two apart keeps a model from concluding there's nothing to commit in a brand-new project.
   */
  noHead?: boolean;
}

// Matches the "diff --git a/<path> b/<path>" line git prints at the start of each file's section —
// the boundary `filterRestrictedDiffChunks` splits on. Also handles mnemonicPrefix mode, where git
// replaces "a"/"b" with any single-letter mnemonic ("c", "i", "o", "w", ...) depending on where each
// side comes from, so any one-letter prefix is accepted. Captures whatever git put after the prefix, quotes and
// core.quotepath escapes included; `reportedPathAllowed` takes care of the quoting before a path is
// judged, the same pragmatic level `gitStatus` applies to its own "-> " rename-arrow splitting.
const DIFF_FILE_HEADER_RE = /^diff --git [^/\s]+\/(.+) [^/\s]+\/(.+)$/;

/**
 * Splits `diffText` into per-file sections on its `diff --git a/<path> b/<path>` headers and drops
 * any section whose old or new path the sandbox protects (`reportedPathAllowed`). git reports what it
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
function filterRestrictedDiffChunks(sb: Sandbox, diffText: string): string {
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
    if (reportedPathAllowed(sb, aPath!) && reportedPathAllowed(sb, bPath!)) kept.push(...lines.slice(start, end));
  }
  return kept.join("\n");
}

/**
 * git C-quotes a whole path when core.quotepath considers any byte in it unusual — `".env\303\251"`,
 * `".env\t"`, a name containing a literal `"` or `\`. Stripping the surrounding quotes before the
 * denylist check keeps the protected part of such a name visible to the matcher. Nothing else is
 * unescaped, and that is enough: git only ever escapes non-ASCII and control bytes, while every
 * pattern in `RESTRICTED_GLOBS` starts with plain ASCII (`.env`, `.git`, `node_modules`, …), so a
 * protected segment can't end up hidden inside an escape sequence. Unquoting can only ever make a
 * path *more* likely to be rejected, never less.
 */
function unquoteGitPath(line: string): string {
  return line.length > 1 && line.startsWith('"') && line.endsWith('"') ? line.slice(1, -1) : line;
}

/** Whether a path git printed (quoted or not) may be shown to the model. */
function reportedPathAllowed(sb: Sandbox, gitPath: string): boolean {
  return sb.allowsReported(gitPath) && sb.allowsReported(unquoteGitPath(gitPath));
}

/**
 * The `--name-only` counterpart of `filterRestrictedDiffChunks`: that one splits a diff into
 * per-file sections on its `diff --git` headers, but name-only output has no headers at all — just
 * one path per line — so protected paths have to be dropped line by line instead. Same guarantee (a
 * tracked `.env` never shows up, even though git reports it), same silence about what was dropped,
 * and the same best-effort stance: a line is just a path we ask the sandbox about.
 *
 * One asymmetry with the diff-body filter, worth knowing: git names only the post-image side of a
 * rename in name-only mode, so a rename *out of* a protected path shows its new, unrestricted name
 * and there is no old-path header to check it against. That name is a path the model may read
 * anyway, and no contents are disclosed with it — `git_status`, which does report both ends of a
 * rename, is the tool that has to hold the stronger claim.
 */
function filterRestrictedNameOnly(sb: Sandbox, nameOnlyText: string): string {
  return nameOnlyText
    .split(/\r\n|\n/)
    .filter((line) => line !== "" && reportedPathAllowed(sb, line))
    .join("\n");
}

/**
 * Runs `git diff HEAD` in `cwd` — i.e. everything that differs from the last commit, staged and
 * unstaged changes alike (an index-only `git diff` would hide work the agent has already staged) —
 * and returns the unified diff text, capped at DEFAULT_MAX_LINES lines / DEFAULT_MAX_BYTES bytes
 * (whichever is hit first): the same shape of cap `readFile` applies to file contents. Untracked
 * files are not part of a diff against HEAD, so they are not reported; `list`/`git_status` cover
 * those.
 *
 * `opts.nameOnly` adds git's `--name-only`, which asks for just the changed paths, one per line —
 * no `--no-patch` needed, `--name-only` implies it. Handy before a big diff: one cheap call tells
 * the model which files to ask about, and it can't disclose any content it wasn't going to hide.
 */
export async function gitDiff(sb: Sandbox, opts: GitDiffOptions = {}): Promise<GitDiffResult> {
  // Force the canonical a/... b/... header form regardless of the user's git config: the
  // restricted-file filter below splits on those headers, and its regex accepts mnemonic
  // prefixes only as a fallback for output shape we don't fully control. This never changes the
  // diff content itself, only the decorative header prefixes.
  const args = ["-c", "diff.mnemonicPrefix=false", "diff", "HEAD"];
  if (opts.nameOnly) args.push("--name-only");
  const scope = opts.path ? sb.relative(opts.path) : ".";
  args.push("--", scope);

  let stdout: string;
  try {
    ({ stdout } = await execFile("git", args, { cwd: sb.root, signal: opts.signal, maxBuffer: MAX_BUFFER }));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).name === "AbortError") throw err;
    // Diffs are taken against HEAD, and a repository whose first commit hasn't been made has no
    // HEAD: git exits non-zero with "bad revision 'HEAD'". Nothing was fetched, so the honest answer
    // is "no baseline to compare against", not "no changes" — see `noHead`.
    if (/bad revision 'HEAD'|does not have any commits yet/.test(describeError(err))) {
      return { text: "", truncated: false, noHead: true };
    }
    throw toolError("git_diff", `git diff failed: ${describeError(err)}`, {
      ...(opts.path !== undefined ? { path: opts.path } : {}),
      ...(opts.nameOnly !== undefined ? { nameOnly: opts.nameOnly } : {}),
    });
  }

  if (stdout === "") return { text: "", truncated: false };

  const filtered = opts.nameOnly ? filterRestrictedNameOnly(sb, stdout) : filterRestrictedDiffChunks(sb, stdout);
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

export function registerGitDiffTool(pi: ToolRegistry) {
  pi.registerTool({
    ...GIT_DIFF_TOOL_DEFINITION,
    prepareArguments: withConciseValidationErrors(GIT_DIFF_TOOL_DEFINITION.name, GIT_DIFF_TOOL_DEFINITION.parameters),
    renderCall(args, theme) {
      let text = callName(theme, "git_diff");
      if (args.nameOnly) text += theme.fg("toolOutput", " --name-only");
      if (args.path) text += theme.fg("toolOutput", ` ${args.path}`);
      return oneLine(text);
    },
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const result = await gitDiff(sandboxFor(ctx.cwd), {
        path: params.path,
        nameOnly: params.nameOnly,
        signal,
      });

      let text = result.text;
      if (result.noHead) text = "The repository has no commit yet, so there is nothing to diff against.";
      else if (text === "") text = "No changes.";
      if (result.truncated) {
        const what = params.nameOnly ? "File list" : "Diff";
        text += `\n\n[${what} truncated. Narrow with path to see less at once, e.g. { path: "<subdirectory>" }.]`;
      }

      return {
        content: [{ type: "text", text: escapeTripleBackticks(text) }],
        details: { truncated: result.truncated, nameOnly: params.nameOnly === true, noHead: result.noHead === true },
      };
    },
  });
}
