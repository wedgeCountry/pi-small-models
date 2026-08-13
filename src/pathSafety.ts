import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Resolves the nearest existing ancestor of `target` and returns its real
 * (symlink-resolved) path joined back with the trailing segments that don't
 * exist yet. Falls back to `target` itself if no ancestor exists (e.g. in
 * tests that use a made-up root that was never created on disk).
 *
 * Exported so `sandbox.ts` can build the same lexical-then-real-path
 * containment check `resolveSafePath` uses below, without duplicating the
 * symlink-resolution logic.
 */
export function realpathWithMissingSuffix(target: string): string {
  const suffixParts: string[] = [];
  let current = target;
  while (true) {
    try {
      const real = fs.realpathSync(current);
      return suffixParts.length ? path.join(real, ...suffixParts) : real;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      const parent = path.dirname(current);
      if (parent === current) return target;
      suffixParts.unshift(path.basename(current));
      current = parent;
    }
  }
}

/**
 * Resolves `target` relative to `root` and guarantees the result stays inside
 * `root`, so tools can never be pointed at files outside the project.
 */
export function resolveSafePath(root: string, target: string): string {
  const resolved = path.resolve(root, target || ".");
  const relative = path.relative(root, resolved);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Path "${target}" is outside the project root`);
  }

  // The lexical check above can't catch a symlink inside root (existing, or
  // created along the way to a not-yet-existing target) that points outside
  // it — resolve real paths and re-check containment to close that gap.
  const realRoot = realpathWithMissingSuffix(root);
  const realResolved = realpathWithMissingSuffix(resolved);
  const realRelative = path.relative(realRoot, realResolved);
  if (realRelative === ".." || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) {
    throw new Error(`Path "${target}" is outside the project root`);
  }

  return resolved;
}

/**
 * True if `entryPath` (resolved relative to `base`, or absolute) stays inside
 * `base`'s real path once symlinks are followed. `base` having already
 * passed `resolveSafePath` doesn't mean every entry discovered beneath it by
 * a directory walk/glob does too — a symlink living inside `base` can still
 * point outside it. Callers should use this to re-check individual entries
 * (typically only ones flagged as symlinks by the walk itself, to avoid a
 * realpath syscall per entry) before disclosing their path or reading their
 * contents.
 */
export function isEntryWithinBase(base: string, entryPath: string): boolean {
  const full = path.isAbsolute(entryPath) ? entryPath : path.join(base, entryPath);
  try {
    const realBase = fs.realpathSync(base);
    const realEntry = fs.realpathSync(full);
    const relative = path.relative(realBase, realEntry);
    return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
  } catch {
    return false; // broken symlink, permission error, etc. — exclude rather than risk it
  }
}
