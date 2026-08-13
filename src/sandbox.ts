import * as path from "node:path";
import micromatch from "micromatch";
import { resolveSafePath, isEntryWithinBase, realpathWithMissingSuffix } from "./pathSafety.ts";

/**
 * `sandbox.ts` is the *only* file outside `pathSafety.ts` itself that imports
 * from it — every tool now goes through `resolveSandboxPath`/`isEntrySandboxSafe`
 * below instead of calling `resolveSafePath`/`isEntryWithinBase` directly, so
 * `pathSafety.ts`'s actual containment mechanism can be swapped out in one
 * place without touching any tool file.
 *
 * On top of `pathSafety.ts`'s hard, always-on containment boundary, this
 * module adds a second, *toggleable* and *mode-aware* layer: e.g. a read-only
 * call can be told ".ssh is off-limits" while an edit-related call is told
 * ".git is off-limits" — see `READ_RESTRICTED_GLOBS`/`EDIT_RESTRICTED_GLOBS`.
 */
export type SandboxMode = "read" | "edit";

/**
 * - `"on"` — full enforcement: `pathSafety.ts`'s root-containment check runs,
 *   and so does the mode-specific restricted-glob check below.
 * - `"off"` — root-containment still runs (a call still can't escape the
 *   project root), but the restricted-glob check is skipped.
 * - `"yolo"` — nothing is enforced, including root-containment. Fully
 *   unsandboxed, same as running the built-in `bash` tool would be.
 */
export type SandboxState = "on" | "off" | "yolo";

/**
 * Restricted-path glob patterns, matched (case-sensitively on Linux,
 * case-insensitively on Windows/macOS — see `CASE_INSENSITIVE_PLATFORM`)
 * against the target's path relative to the project root, POSIX-normalized
 * (forward slashes) so the same patterns work unchanged on every platform.
 * Every pattern is `**`-anchored so it fires regardless of nesting depth
 * (`.env` at the project root and `packages/api/.env` both match `**\/.env*`).
 *
 * Read mode protects credential material that would leak secrets if
 * disclosed to the model.
 */
export const READ_RESTRICTED_GLOBS: readonly string[] = ["**/.ssh/**", "**/.aws/**", "**/.env*", "**/.netrc"];

/**
 * Edit mode protects repository-internal state that would corrupt version
 * control (or leak secrets) if mutated.
 */
export const EDIT_RESTRICTED_GLOBS: readonly string[] = ["**/.git/**", "**/.env*"];

// Windows, and macOS's default APFS/HFS+ configuration, are case-insensitive
// (but case-preserving) filesystems — ".SSH" and ".ssh" name the same
// directory there. Linux stays case-sensitive, matching its actual
// filesystem semantics.
const CASE_INSENSITIVE_PLATFORM = process.platform === "win32" || process.platform === "darwin";

// Module-level, in-memory only — no persistence across process restarts, same
// as the rest of this extension's toggleable behavior. Starts fully enforced.
let sandboxState: SandboxState = "on";

export function getSandboxState(): SandboxState {
  return sandboxState;
}

export function setSandboxState(state: SandboxState): void {
  sandboxState = state;
}

const STATE_CYCLE: readonly SandboxState[] = ["on", "off", "yolo"];

/** Advances to the next state in `STATE_CYCLE` (wrapping around) and returns it. */
export function cycleSandboxState(): SandboxState {
  const next = STATE_CYCLE[(STATE_CYCLE.indexOf(sandboxState) + 1) % STATE_CYCLE.length]!;
  sandboxState = next;
  return sandboxState;
}

function toPosixRelative(from: string, to: string): string {
  return path.relative(from, to).split(path.sep).join("/");
}

/**
 * True if `resolved` falls under one of `mode`'s restricted glob patterns.
 * Checked twice: once against the lexical path relative to `anchor` (the
 * path as named/typed), and once against the real, symlink-resolved path —
 * so a symlink named e.g. `not-git` that actually points at `.git` is still
 * caught, even though its own name would never match a `.git` pattern.
 */
function matchesRestrictedGlob(anchor: string, resolved: string, mode: SandboxMode): boolean {
  const patterns = (mode === "read" ? READ_RESTRICTED_GLOBS : EDIT_RESTRICTED_GLOBS) as string[];
  const options = { dot: true, nocase: CASE_INSENSITIVE_PLATFORM };

  const lexicalRelative = toPosixRelative(anchor, resolved);
  if (lexicalRelative !== "" && micromatch.isMatch(lexicalRelative, patterns, options)) {
    return true;
  }

  const realAnchor = realpathWithMissingSuffix(anchor);
  const realResolved = realpathWithMissingSuffix(resolved);
  const realRelative = toPosixRelative(realAnchor, realResolved);
  return realRelative !== "" && micromatch.isMatch(realRelative, patterns, options);
}

/**
 * Resolves `target` against `root`, the way every tool's `execute()` used to
 * call `resolveSafePath` directly — now the single entry point tools use
 * instead. Throws on any violation, with a message identifying which layer
 * rejected it.
 *
 * - `"yolo"`: skips `resolveSafePath` entirely and just lexically resolves
 *   the path, so a target outside the project root is allowed through.
 * - `"off"`: still calls `resolveSafePath` (root-containment stays
 *   enforced), but skips the restricted-glob check.
 * - `"on"`: both checks run.
 */
export function resolveSandboxPath(root: string, target: string, mode: SandboxMode): string {
  if (sandboxState === "yolo") {
    return path.resolve(root, target || ".");
  }

  const resolved = resolveSafePath(root, target);

  if (sandboxState === "on" && matchesRestrictedGlob(path.resolve(root), resolved, mode)) {
    throw new Error(`Path "${target}" is restricted in ${mode} mode by the sandbox (see src/sandbox.ts)`);
  }

  return resolved;
}

/**
 * Filter predicate for entries discovered while walking `base` (a directory
 * already validated via `resolveSandboxPath`) — the mode-aware replacement
 * for calling `isEntryWithinBase` directly. Unlike the symlink-escape check
 * (which only matters for symlinked entries — a plain entry discovered by a
 * directory walk is inherently inside `base` already), the restricted-glob
 * check runs against every entry regardless of symlink status, since e.g.
 * `.ssh` is ordinarily a real, non-symlinked directory.
 *
 * `entryPath` is relative to `base` (as `find`/`grep`/`list`'s walks already
 * produce). `isSymlink` lets the (comparatively expensive) real-path
 * containment check stay skipped for the overwhelming majority of entries
 * that aren't symlinks, same as the perf note in `pathSafety.ts`.
 */
export function isEntrySandboxSafe(base: string, entryPath: string, mode: SandboxMode, isSymlink: boolean): boolean {
  if (sandboxState === "yolo") return true;

  if (sandboxState === "on") {
    const full = path.isAbsolute(entryPath) ? entryPath : path.join(base, entryPath);
    if (matchesRestrictedGlob(path.resolve(base), full, mode)) return false;
  }

  if (isSymlink && !isEntryWithinBase(base, entryPath)) return false;

  return true;
}

/**
 * True when `target` is a real child (or the project root itself) of `root`
 * — following symlinks — and doesn't fall under one of `mode`'s restricted
 * paths, per the current `SandboxState`. Non-throwing wrapper around
 * `resolveSandboxPath`, for callers that want a predicate rather than a
 * guard (e.g. tests, or a caller that wants to check several candidates
 * without a try/catch per candidate).
 */
export function directoryIsSafe(root: string, target: string, mode: SandboxMode): boolean {
  try {
    resolveSandboxPath(root, target, mode);
    return true;
  } catch {
    return false;
  }
}

/**
 * Same check as `directoryIsSafe`, offered as a separately named function so
 * call sites can express intent (checking a file vs. a directory) even
 * though the underlying logic is identical — neither the target's actual
 * type on disk nor its existence is checked here.
 */
export function fileIsSafe(root: string, target: string, mode: SandboxMode): boolean {
  return directoryIsSafe(root, target, mode);
}
