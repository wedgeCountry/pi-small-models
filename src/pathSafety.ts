import * as path from "node:path";

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
  return resolved;
}
