import * as fs from "node:fs/promises";
import * as path from "node:path";
import { withFileMutationQueue } from "./mutationQueue.ts";

export const DEFAULT_IGNORE_GLOBS = [
  "**/node_modules/**",
  "**/.git/**",
  "**/.venv/**",
  "**/__pycache__/**",
  "**/dist/**",
  "**/build/**",
  "**/.pi/**",
];

export const DEFAULT_IGNORE_NAMES = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".pi",
]);

/** Filename of the local, per-project ignore file — a plain dotfile at the project root. */
export const LOCAL_IGNORE_FILENAME = ".piignore";

/** Filename of the global ignore file, stored inside Pi's own agent config dir (`getAgentDir()`). */
export const GLOBAL_IGNORE_FILENAME = ".piignore";

/** Path to the local ignore file for a project rooted at `root`. */
export function getLocalIgnorePath(root: string): string {
  return path.join(root, LOCAL_IGNORE_FILENAME);
}

/** Path to the global ignore file inside `agentDir` (from `getAgentDir()` in the `pi-coding-agent` package). */
export function getGlobalIgnorePath(agentDir: string): string {
  return path.join(agentDir, GLOBAL_IGNORE_FILENAME);
}

/**
 * Reads one ignore file's glob patterns: one per line, blank lines and `#`-prefixed comments
 * skipped (same basic conventions as `.gitignore`). Returns `[]`, not an error, when the file
 * doesn't exist — neither ignore file is required to be present.
 */
export async function readIgnoreFile(filePath: string): Promise<string[]> {
  let content: string;
  try {
    content = await fs.readFile(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  return content
    .split(/\r\n|\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
}

/**
 * Loads the user-added ignore patterns from both the global (`agentDir`) and local (`root`) ignore
 * files, in that order, de-duplicated so adding the same pattern to both files doesn't double it
 * up in the merged list.
 */
export async function loadCustomIgnoreGlobs(root: string, agentDir: string): Promise<string[]> {
  const [globalPatterns, localPatterns] = await Promise.all([
    readIgnoreFile(getGlobalIgnorePath(agentDir)),
    readIgnoreFile(getLocalIgnorePath(root)),
  ]);
  return [...new Set([...globalPatterns, ...localPatterns])];
}

/**
 * The full set of ignore globs `find`/`grep`/`list` should apply: the extension's hardcoded
 * defaults above, plus whatever the user has added on top via `/ignore <pattern>` (global) or by
 * hand-editing the local `.piignore` file at the project root.
 */
export async function getEffectiveIgnoreGlobs(root: string, agentDir: string): Promise<string[]> {
  return [...DEFAULT_IGNORE_GLOBS, ...(await loadCustomIgnoreGlobs(root, agentDir))];
}

/**
 * Appends `pattern` as a new line to the global ignore file, creating `agentDir` and the file
 * itself if either doesn't exist yet. No-ops (reports `added: false`) if the pattern is already
 * present, so repeated `/ignore <pattern>` calls don't pile up duplicate lines. Runs under
 * `withFileMutationQueue` so a concurrent append can't interleave with this read-modify-write,
 * same as `insertText`/`editFile`/`writeFile`/`removePath`.
 */
export async function appendGlobalIgnorePattern(agentDir: string, pattern: string): Promise<{ added: boolean }> {
  const filePath = getGlobalIgnorePath(agentDir);
  return withFileMutationQueue(filePath, async () => {
    const existing = await readIgnoreFile(filePath);
    if (existing.includes(pattern)) return { added: false };

    await fs.mkdir(agentDir, { recursive: true });
    let current = "";
    try {
      current = await fs.readFile(filePath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    const needsLeadingNewline = current.length > 0 && !current.endsWith("\n");
    await fs.appendFile(filePath, `${needsLeadingNewline ? "\n" : ""}${pattern}\n`, "utf8");
    return { added: true };
  });
}
