import * as fs from "node:fs/promises";

/**
 * Checks if a file or directory exists at the given path.
 * Returns true if the path exists, false if it doesn't (ENOENT).
 * Re-throws any other errors (permission denied, etc.).
 */
export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.lstat(targetPath);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

/**
 * Ensures the parent directory of a file path exists.
 * Creates all missing parent directories recursively.
 * Does not check if the file itself exists.
 */
export async function ensureParentDirectory(filePath: string): Promise<void> {
  const parentDir = filePath.substring(0, filePath.lastIndexOf("/"));
  if (parentDir.length > 0) {
    await fs.mkdir(parentDir, { recursive: true });
  }
}
