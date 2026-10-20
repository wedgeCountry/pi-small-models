import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** Project-relative POSIX path when `abs` is inside `root`, otherwise absolute with $HOME shortened to `~`. */
export function displayPath(root: string, abs: string): string {
  const rel = path.relative(root, abs);
  if (rel === "") return ".";
  if (!rel.startsWith("..") && !path.isAbsolute(rel)) return rel.split(path.sep).join("/");
  const home = os.homedir();
  if (home && (abs === home || abs.startsWith(home + path.sep))) return `~${abs.slice(home.length).split(path.sep).join("/")}`;
  return abs.split(path.sep).join("/");
}

/** `dir`, its parent, …, up to the filesystem root. */
export function ancestors(dir: string): string[] {
  const out: string[] = [];
  let current = path.resolve(dir);
  while (true) {
    out.push(current);
    const parent = path.dirname(current);
    if (parent === current) return out;
    current = parent;
  }
}

export function realpathOr(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

export function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}
