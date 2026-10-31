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
    readonly reason: "outside-root" | "outside-libraries" | "restricted",
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

    // Prevent using the home directory as a project root
    if (this.root === os.homedir()) {
      throw new SandboxError(
        "outside-root",
        `Sandbox root "${this.root}" is the user's home directory, which cannot be used as a project root`
      );
    }

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

    // Prevent tilde expansion which could escape the sandbox
    if (target.includes("~")) {
      throw new SandboxError(
        "outside-root",
        `Path "${target}" contains tilde (~) which is not allowed in sandboxed paths`
      );
    }

    // Prevent environment variable syntax which could expand to paths outside the sandbox
    // This catches: $VAR, ${VAR}, %VAR%, $VAR/path, ${VAR}/path, %VAR%/path, etc.
    // The regex now properly handles environment variables followed by path separators
    if (/[\$\%][\w\d_]+(\/|\\|$)|\$\{[^}]*\}|%[^%]+%/.test(target)) {
      throw new SandboxError(
        "outside-root",
        `Path "${target}" contains environment variable syntax which is not allowed in sandboxed paths`
      );
    }

    // Prevent Unicode path separators and lookalikes that could bypass validation
    // This catches: full-width slash (／), ellipsis (…), and other lookalikes
    // Expanded list of problematic Unicode characters that can be used for path traversal
    if (/[／\u2026\u2215\u2216\u2571\u2993\u2994\u2995\u2996\uFF0F\uFF1F\uFF0E]/.test(target)) {
      throw new SandboxError(
        "outside-root",
        `Path "${target}" contains Unicode characters that are not allowed in sandboxed paths`
      );
    }

    // Prevent control characters in paths that could be used to create
    // visually similar or hidden directory names (e.g., .git\u0001, .git\t)
    if (/[\x00-\x1F\x7F]/.test(target)) {
      throw new SandboxError(
        "outside-root",
        `Path "${target}" contains control characters which are not allowed in sandboxed paths`
      );
    }

    // Prevent paths that use other Unicode whitespace characters that could bypass restrictions
    // This catches attempts with various Unicode space characters
    if (/[\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]/.test(target)) {
      throw new SandboxError(
        "outside-root",
        `Path "${target}" contains Unicode whitespace characters which are not allowed in sandboxed paths`
      );
    }

    // Prevent paths that contain restricted directory names with whitespace
    // This catches attempts like ".git /file", ".git\t/file", "node_modules /file", etc. which could bypass the restriction
    if (/\s/.test(target)) {
      // Split by any whitespace and check each segment
      const segments = target.split(/\s+/);
      for (const segment of segments) {
        if (segment === ".git" || segment === ".venv" || segment === "node_modules" || 
            segment === "bower_components" || segment === "jspm_packages") {
          throw new SandboxError(
            "restricted",
            `Path "${target}" contains a restricted directory name with whitespace`
          );
        }
      }
    }

    // Prevent paths that use Unicode lookalike characters for dots or slashes
    // This catches attempts to use characters that look like . or / but are different Unicode characters
    if (/[\u2024\u2219\u2981\uFF0E\uFF61]/.test(target)) {
      throw new SandboxError(
        "outside-root",
        `Path "${target}" contains Unicode lookalike characters which are not allowed in sandboxed paths`
      );
    }
    // Decode URL-encoded characters to prevent bypass via encoding
    // This handles %2e (.), %2f (/), %5c (\), etc.
    try {
      if (target.includes("%")) {
        // Check if the string contains URL-encoded characters
        // We need to decode and check if the decoded version would be blocked
        const decoded = decodeURIComponent(target);
        // If decoding changes the string, validate the decoded version
        if (decoded !== target) {
          // Recursively validate the decoded path
          return this.resolve(decoded);
        }
      }
    } catch (e) {
      // If decodeURIComponent fails (malformed URI), reject the path
      throw new SandboxError(
        "outside-root",
        `Path "${target}" contains malformed URL encoding`
      );
    }

    // Normalize backslashes to forward slashes for consistent path handling
    // This ensures that path traversal using backslashes (e.g., "..\..\file") 
    // gets properly detected regardless of the host platform
    let normalizedTarget = target.replace(/\\/g, '/');

    // Resolve to absolute path using normalized target
    const absolutePath = path.resolve(this.root, normalizedTarget || ".");
    
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
    return isInside(relPath) && !isRestricted(relPath);
  }

  /**
   * Resolves a file inside an installed package. The model never names these files; tools derive
   * `libRoots` from package-manager metadata. The file must really lie under one of the roots and
   * must not match a protected pattern relative to it. Read-only use only.
   */
  resolveLibraryFile(libRoots: readonly string[], target: string): string {
    const resolved = path.resolve(target);
    if (!this.enforced) return resolved;

    const real = resolveRealPathWithFallback(resolved);
    for (const libRoot of libRoots) {
      const lexicalRoot = path.resolve(libRoot);
      const realRelative = path.relative(resolveRealPathWithFallback(lexicalRoot), real);
      if (!isInside(realRelative)) continue;
      if (isRestricted(path.relative(lexicalRoot, resolved)) || isRestricted(realRelative)) {
        throw new SandboxError("restricted", `Library file "${target}" is restricted by the sandbox`);
      }
      return resolved;
    }
    throw new SandboxError(
      "outside-libraries",
      `Library file "${target}" is outside the installed-package locations this tool may read`
    );
  }

  /** Non-throwing form of `resolveLibraryFile`. */
  allowsLibraryFile(libRoots: readonly string[], target: string): boolean {
    try {
      this.resolveLibraryFile(libRoots, target);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if a directory contains any restricted files or subdirectories.
   * Used by copy/move to prevent exposing restricted content.
   */
  async hasRestrictedDescendant(dirPath: string): Promise<boolean> {
    if (!this.enforced) return false;

    // Convert absolute path to relative path if needed
    let relativePath = dirPath;
    if (path.isAbsolute(dirPath)) {
      relativePath = path.relative(this.root, dirPath);
    }

    // First check the directory itself using resolve
    try {
      this.resolve(relativePath);
    } catch (err) {
      if (err instanceof SandboxError) {
        return true; // Directory itself is restricted or outside root
      }
      throw err;
    }

    // Walk the directory tree, tracking visited directories to terminate on cycles
    return this.walkDirectoryForRestricted(dirPath, new Set());
  }

  /**
   * Recursively walk a directory to check for restricted entries.
   * Uses the same validation logic as entryFilter for consistency.
   */
  private async walkDirectoryForRestricted(dir: string, visited: Set<string>): Promise<boolean> {
    const realDir = resolveRealPathWithFallback(dir);
    if (visited.has(realDir)) {
      return false;
    }
    visited.add(realDir);
    const entries = await fsPromises.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = entry.name;
      const fullPath = path.join(dir, entryPath);
      const isSymlink = entry.isSymbolicLink();
      
      // Check if this entry is restricted using the same logic as entryFilter
      // First check lexical path
      const lexicalRelative = path.relative(this.root, fullPath);
      if (isRestricted(lexicalRelative)) {
        return true;
      }
      
      // Check real path
      try {
        const realPath = resolveRealPathWithFallback(fullPath);
        const realRelative = path.relative(this.getRealRoot(), realPath);
        if (isRestricted(realRelative)) {
          return true;
        }
        // Also check if real path is outside root
        if (!isInside(realRelative)) {
          return true;
        }
      } catch {
        // Path doesn't exist or can't be resolved, skip
        continue;
      }

      // For directories and symlinks to directories, recurse
      if (entry.isDirectory()) {
        if (await this.walkDirectoryForRestricted(fullPath, visited)) {
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
              if (await this.walkDirectoryForRestricted(realPath, visited)) {
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
