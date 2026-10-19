import * as fs from "node:fs";
import { promises as fsPromises } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { isInside, isRestricted } from "./policy.ts";

/**
 * The sandbox every tool goes through. A `Sandbox` is an unchangeable snapshot for one tool call:
 * a project root plus whether rules are enforced. Tools never check paths themselves — they ask
 * the sandbox to resolve a path the model gave (`resolve`), to filter what a directory walk found
 * (`entryFilter`), or to filter paths another program reported (`allowsReported`).
 *
 * When enforced, a path must stay inside its root and must not match `policy.ts`'s protected
 * patterns. Both are checked on the path as given and on its real, symlink-resolved location, so a
 * symlink can neither escape the root nor disguise a protected path. When not enforced, nothing is
 * checked and `permissionGate.ts` asks the user before each call instead.
 */

export type SandboxState = "on" | "off";

/**
 * Error thrown when a path violates sandbox rules.
 */
export class SandboxError extends Error {
  constructor(
    readonly reason: "outside-root" | "restricted",
    message: string
  ) {
    super(message);
    this.name = "SandboxError";
  }
}

/**
 * Global sandbox state. Reset to "on" at each session start.
 */
let globalState: SandboxState = "on";

/** Get current sandbox state */
export function getSandboxState(): SandboxState {
  return globalState;
}

/** Set sandbox state */
export function setSandboxState(next: SandboxState): void {
  globalState = next;
}

/**
 * The sandbox for validating file operations.
 * 
 * Each Sandbox instance is immutable and tied to a specific root directory
 * and enforcement state (snapshotted at creation time).
 */
export class Sandbox {
  readonly root: string;
  readonly enforced: boolean;
  
  // Cache for the real (symlink-resolved) root path
  private realRootCache: string | null = null;

  constructor(root: string, enforced: boolean = true) {
    this.root = path.resolve(root);
    this.enforced = enforced;
  }

  /**
   * Get the real (symlink-resolved) root path, caching the result.
   */
  private getRealRoot(): string {
    if (this.realRootCache === null) {
      this.realRootCache = resolveRealPathWithFallback(this.root);
    }
    return this.realRootCache;
  }

  /**
   * Resolve a model-provided path to an absolute path, validating it against sandbox rules.
   * 
   * @throws SandboxError if path is outside root or restricted
   */
  resolve(target: string): string {
    // If sandbox is not enforced, skip all checks
    if (!this.enforced) {
      return path.resolve(this.root, target || ".");
    }

    // Prevent using home directory as project root
    if (this.root === os.homedir()) {
      throw new SandboxError(
        "outside-root",
        `Path "${target}" is the user's home directory, which cannot be used as a project root`
      );
    }

    // Resolve to absolute path
    const absolutePath = path.resolve(this.root, target || ".");
    
    // Check lexical path (relative to root)
    const lexicalRelative = path.relative(this.root, absolutePath);
    if (!isInside(lexicalRelative)) {
      throw new SandboxError("outside-root", `Path "${target}" is outside the project root`);
    }
    if (isRestricted(lexicalRelative)) {
      throw new SandboxError("restricted", `Path "${target}" is restricted by the sandbox`);
    }

    // Check real path (resolving symlinks)
    const realPath = resolveRealPathWithFallback(absolutePath);
    const realRelative = path.relative(this.getRealRoot(), realPath);
    if (!isInside(realRelative)) {
      throw new SandboxError("outside-root", `Path "${target}" is outside the project root`);
    }
    if (isRestricted(realRelative)) {
      throw new SandboxError("restricted", `Path "${target}" is restricted by the sandbox`);
    }

    return absolutePath;
  }

  /**
   * Get a path relative to the root, suitable for passing to child processes.
   * Adds "./" prefix if path starts with "-" to prevent option injection.
   */
  relative(target: string): string {
    const resolved = this.resolve(target);
    let rel = path.relative(this.root, resolved);
    
    // Prevent option injection attacks (e.g., "-rf" as a path)
    if (rel.startsWith("-")) {
      rel = `./${rel}`;
    }
    
    return rel;
  }

  /**
   * Create a filter function for directory entries.
   * Used by list/find/grep to filter out restricted entries.
   * 
   * @param base - The base directory being walked (already resolved)
   * @returns A function that takes an entry path and symlink flag, returns whether it's allowed
   */
  entryFilter(base: string): (entryPath: string, isSymlink: boolean) => boolean {
    if (!this.enforced) {
      // Sandbox off: allow everything
      return () => true;
    }

    const baseRealPath = resolveRealPathWithFallback(base);
    const rootRealPath = this.getRealRoot();

    return (entryPath, isSymlink) => {
      // Build full lexical path
      const fullLexicalPath = path.resolve(base, entryPath);
      const lexicalRelative = path.relative(this.root, fullLexicalPath);
      
      // Reject if lexical path is restricted
      if (isRestricted(lexicalRelative)) {
        return false;
      }

      // Get real path of the entry
      let realPath: string;
      if (isSymlink) {
        // For symlinks, we need to resolve the actual target
        const resolved = resolveRealPathOrUndefined(fullLexicalPath);
        if (resolved === undefined) {
          // Broken symlink: reject
          return false;
        }
        realPath = resolved;
      } else {
        // For regular entries, build real path from base real path
        realPath = path.join(baseRealPath, path.relative(base, fullLexicalPath));
      }

      // Check real path is inside root and not restricted
      const realRelative = path.relative(rootRealPath, realPath);
      return isInside(realRelative) && !isRestricted(realRelative);
    };
  }

  /**
   * Check if a root-relative path reported by an external program (e.g., git) is allowed.
   */
  allowsReported(relPath: string): boolean {
    if (!this.enforced) return true;
    return !isRestricted(relPath);
  }

  /**
   * Check if a directory contains any restricted files or subdirectories.
   * Used by copy/move to prevent exposing restricted content.
   */
  async hasRestrictedDescendant(dirPath: string): Promise<boolean> {
    if (!this.enforced) return false;

    // First check the directory itself using resolve
    try {
      this.resolve(dirPath);
    } catch (err) {
      if (err instanceof SandboxError) {
        return true; // Directory itself is restricted or outside root
      }
      throw err;
    }

    // Walk the directory tree using a filter that leverages our existing validation
    return this.walkDirectoryForRestricted(dirPath);
  }

  /**
   * Recursively walk a directory to check for restricted entries.
   * Uses the sandbox's own entryFilter for consistent validation.
   */
  private async walkDirectoryForRestricted(dir: string): Promise<boolean> {
    // Create a filter for this directory using our existing entryFilter method
    const filter = this.entryFilter(dir);
    
    const entries = await fsPromises.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = entry.name;
      const isSymlink = entry.isSymbolicLink();
      
      // Use our existing filter to check if entry is allowed
      // If filter returns false, the entry is restricted
      if (!filter(entryPath, isSymlink)) {
        return true;
      }

      // For directories and symlinks to directories, recurse
      const fullPath = path.join(dir, entryPath);
      
      if (entry.isDirectory()) {
        if (await this.walkDirectoryForRestricted(fullPath)) {
          return true;
        }
      } else if (isSymlink) {
        // For symlinks, check if they point to a directory
        try {
          const realPath = await fsPromises.realpath(fullPath);
          const stat = await fsPromises.stat(realPath);
          if (stat.isDirectory()) {
            // Validate the symlink target is within bounds
            try {
              this.resolve(realPath);
              if (await this.walkDirectoryForRestricted(realPath)) {
                return true;
              }
            } catch (err) {
              if (err instanceof SandboxError) {
                return true; // Symlink target is restricted
              }
              // Other errors (permission, etc.) - skip
            }
          }
        } catch {
          // Broken symlink or can't stat - skip
        }
      }
    }

    return false;
  }
}

/**
 * Create a Sandbox instance for the given root, using the current global state.
 */
export function sandboxFor(root: string): Sandbox {
  return new Sandbox(root, globalState === "on");
}

/**
 * Standalone function for checking if an entry is sandbox-safe.
 * Used by grepWorker which runs in a separate thread.
 */
export function isEntrySandboxSafe(
  root: string,
  base: string,
  entryPath: string,
  isSymlink: boolean,
  stateOverride?: SandboxState
): boolean {
  const sb = new Sandbox(root, (stateOverride ?? globalState) === "on");
  const filter = sb.entryFilter(base);
  return filter(entryPath, isSymlink);
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Resolve the real path of a target, handling non-existent files by resolving
 * the nearest existing ancestor and re-attaching the missing parts.
 * 
 * This is important for validating paths that don't exist yet (e.g., a file
 * about to be created).
 */
function resolveRealPathWithFallback(target: string): string {
  const missingParts: string[] = [];
  let current = target;

  while (true) {
    try {
      return path.join(fs.realpathSync(current), ...missingParts);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err;
      }
      const parent = path.dirname(current);
      if (parent === current) {
        // Reached root without finding existing path
        return target;
      }
      missingParts.unshift(path.basename(current));
      current = parent;
    }
  }
}

/**
 * Try to resolve the real path, returning undefined on error.
 * Used for checking symlinks that might be broken.
 */
function resolveRealPathOrUndefined(target: string): string | undefined {
  try {
    return fs.realpathSync(target);
  } catch {
    return undefined;
  }
}
