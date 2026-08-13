import * as path from "node:path";
import micromatch from "micromatch";
import { realpathWithMissingSuffix } from "./pathSafety.ts";

/**
 * `directoryIsSafe`/`fileIsSafe` are mode-aware, non-throwing predicates layered
 * on top of (not a replacement for) `resolveSafePath`. `resolveSafePath` is the
 * hard boundary every tool's `execute()` already calls before touching the
 * filesystem; this module adds a second, *toggleable* and *mode-aware* check —
 * e.g. so a caller doing something read-only can be told ".ssh is off-limits"
 * while a caller doing something edit-related is told ".git is off-limits" —
 * without changing what `resolveSafePath` itself allows.
 */
export type SandboxMode = "read" | "edit";

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
// as the rest of this extension's toggleable behavior. Starts enabled.
let sandboxEnabled = true;

export function isSandboxEnabled(): boolean {
  return sandboxEnabled;
}

export function setSandboxEnabled(enabled: boolean): void {
  sandboxEnabled = enabled;
}

/** Flips the enabled flag and returns the new state. */
export function toggleSandbox(): boolean {
  sandboxEnabled = !sandboxEnabled;
  return sandboxEnabled;
}

function toPosixRelative(from: string, to: string): string {
  return path.relative(from, to).split(path.sep).join("/");
}

/**
 * True if `resolved` (an already `path.resolve()`d absolute path) is `root`
 * itself or a real descendant of it, once symlinks are followed. Mirrors
 * `resolveSafePath`'s two-layer (lexical, then real-path) containment check
 * — see `pathSafety.ts` — but returns a boolean instead of throwing, since
 * `directoryIsSafe`/`fileIsSafe` are predicates, not guards.
 */
function isRealDescendantOrSelf(root: string, resolved: string): boolean {
  const relative = path.relative(root, resolved);
  if (relative !== "" && (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))) {
    return false;
  }

  const realRoot = realpathWithMissingSuffix(root);
  const realResolved = realpathWithMissingSuffix(resolved);
  const realRelative = path.relative(realRoot, realResolved);
  return realRelative === "" || (realRelative !== ".." && !realRelative.startsWith(`..${path.sep}`) && !path.isAbsolute(realRelative));
}

/**
 * True if `resolved` falls under one of `mode`'s restricted glob patterns.
 * Checked twice: once against the lexical path relative to `root` (the path
 * as named/typed), and once against the real, symlink-resolved path — so a
 * symlink named e.g. `not-git` that actually points at `.git` is still
 * caught, even though its own name would never match a `.git` pattern.
 */
function matchesRestrictedGlob(root: string, resolved: string, mode: SandboxMode): boolean {
  const patterns = (mode === "read" ? READ_RESTRICTED_GLOBS : EDIT_RESTRICTED_GLOBS) as string[];
  const options = { dot: true, nocase: CASE_INSENSITIVE_PLATFORM };

  const lexicalRelative = toPosixRelative(root, resolved);
  if (lexicalRelative !== "" && micromatch.isMatch(lexicalRelative, patterns, options)) {
    return true;
  }

  const realRoot = realpathWithMissingSuffix(root);
  const realResolved = realpathWithMissingSuffix(resolved);
  const realRelative = toPosixRelative(realRoot, realResolved);
  return realRelative !== "" && micromatch.isMatch(realRelative, patterns, options);
}

function checkPathSafety(root: string, target: string, mode: SandboxMode): boolean {
  if (!sandboxEnabled) return true;

  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, target || ".");

  if (!isRealDescendantOrSelf(resolvedRoot, resolved)) return false;
  if (matchesRestrictedGlob(resolvedRoot, resolved, mode)) return false;
  return true;
}

/**
 * True when `target` is a real child (or the project root itself) of `root`
 * — following symlinks — and doesn't fall under one of `mode`'s restricted
 * paths. Returns `false` on any violation rather than throwing.
 *
 * When the sandbox is disabled (`setSandboxEnabled(false)` / `/toggle-sandbox`),
 * always returns `true`.
 */
export function directoryIsSafe(root: string, target: string, mode: SandboxMode): boolean {
  return checkPathSafety(root, target, mode);
}

/**
 * Same check as `directoryIsSafe`, offered as a separately named function so
 * call sites can express intent (checking a file vs. a directory) even
 * though the underlying containment/restricted-glob logic is identical —
 * neither the target's actual type on disk nor its existence is checked
 * here.
 */
export function fileIsSafe(root: string, target: string, mode: SandboxMode): boolean {
  return checkPathSafety(root, target, mode);
}
