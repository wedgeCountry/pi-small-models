import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Resolves the nearest existing ancestor of `target` and returns its real
 * (symlink-resolved) path joined back with the trailing segments that don't
 * exist yet. Falls back to `target` itself if no ancestor exists (e.g. in
 * tests that use a made-up root that was never created on disk).
 */
function realpathWithMissingSuffix(target: string): string {
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
