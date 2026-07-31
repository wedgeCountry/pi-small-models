import fg from "fast-glob";
import { DEFAULT_IGNORE_GLOBS } from "./ignore.ts";

export interface FindOptions {
  maxResults?: number;
}

export interface FindResult {
  matches: string[];
  total: number;
  truncated: boolean;
}

/** Finds files/directories under `base` matching a glob pattern. */
export async function findFiles(base: string, pattern: string, opts: FindOptions = {}): Promise<FindResult> {
  const max = opts.maxResults ?? 200;
  const matches = await fg(pattern, {
    cwd: base,
    ignore: DEFAULT_IGNORE_GLOBS,
    onlyFiles: false,
    dot: false,
    followSymbolicLinks: false,
  });
  matches.sort();
  const truncated = matches.length > max;
  return { matches: matches.slice(0, max), total: matches.length, truncated };
}
