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

export class SandboxError extends Error {
  constructor(
    readonly reason: "outside-root" | "restricted",
    message: string
  ) {
    super(message);
    this.name = "SandboxError";
  }
}

export class Sandbox {
  readonly root: string;
  #realRoot: string | undefined;

  constructor(root: string, readonly enforced = true) {
    this.root = path.resolve(root);
  }

  /** Resolves a model-supplied path against the root. Throws `SandboxError` if it isn't allowed. */
  resolve(target: string): string {
    const resolved = path.resolve(this.root, target || ".");
    if (!this.enforced) return resolved;

    // Refuse to operate if the root is the user's home directory
    if (this.root === os.homedir()) {
      throw new SandboxError("outside-root", `Path "${target}" is the user's home directory, which cannot be used as a project root`);
    }

    const lexical = path.relative(this.root, resolved);
    const real = path.relative(this.realRoot(), realpathWithMissingSuffix(resolved));
    if (!isInside(lexical) || !isInside(real)) {
      throw new SandboxError("outside-root", `Path "${target}" is outside the project root`);
    }
    if (isRestricted(lexical) || isRestricted(real)) {
      throw new SandboxError("restricted", `Path "${target}" is restricted by the sandbox`);
    }
    return resolved;
  }

  /** Like `resolve`, but relative to the root ("" for the root itself), for programs run in the root. */
  relative(target: string): string {
    const resolved = this.resolve(target);
    let rel = path.relative(this.root, resolved);
    // Prevent option injection: if the relative path starts with "-", prefix it with "./"
    if (rel.startsWith("-")) {
      rel = `./${rel}`;
    }
    return rel;
  }

  /**
   * Returns a filter for entries a walk found under `base` (a path `resolve` returned). Entries
   * may be relative to `base` or absolute. Protected entries are dropped, matched relative to the
   * root. A symlinked entry must also really resolve inside the root; a broken one is dropped.
   * Plain entries cost no system call: a walk that doesn't follow symlinks finds them where
   * their real path says they are.
   */
  entryFilter(base: string): (entryPath: string, isSymlink: boolean) => boolean {
    if (!this.enforced) return () => true;

    const lexicalBase = path.resolve(this.root, base);
    const realBase = realpathWithMissingSuffix(lexicalBase);
    return (entryPath, isSymlink) => {
      const lexical = path.resolve(lexicalBase, entryPath);
      if (isRestricted(path.relative(this.root, lexical))) return false;

      const real = isSymlink ? realpathOrUndefined(lexical) : path.join(realBase, path.relative(lexicalBase, lexical));
      if (real === undefined) return false;
      const realRelative = path.relative(this.realRoot(), real);
      return isInside(realRelative) && !isRestricted(realRelative);
    };
  }

  /** True if a root-relative path reported by another program (e.g. git) may be shown. */
  allowsReported(relPath: string): boolean {
    return !this.enforced || !isRestricted(relPath);
  }

  /**
   * Checks if a directory contains any restricted entries by walking its contents.
   * Used by copy/move to prevent exposing restricted files through directory operations.
   * This checks paths relative to the root, so a restricted file like .config/gcloud/credentials.db
   * will be caught even if we're copying the .config directory itself.
   */
  async hasRestrictedDescendant(dirPath: string): Promise<boolean> {
    if (!this.enforced) return false;
    
    // Use real paths to handle symlinks in the directory path itself
    const realDirPath = realpathWithMissingSuffix(dirPath);
    const relFromRoot = path.relative(this.realRoot(), realDirPath);
    
    // Also check the directory itself
    if (isRestricted(relFromRoot)) {
      return true;
    }
    
    const walk = async (dir: string, relFromRoot: string): Promise<boolean> => {
      const entries = await fsPromises.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const entryRelFromRoot = relFromRoot ? `${relFromRoot}/${entry.name}` : entry.name;
        
        // Check if this entry is restricted (by lexical path relative to root)
        if (isRestricted(entryRelFromRoot)) {
          return true;
        }
        
        // Also check the real path of this entry
        const fullPath = path.join(dir, entry.name);
        try {
          const realPath = realpathWithMissingSuffix(fullPath);
          const realRelFromRoot = path.relative(this.realRoot(), realPath);
          if (isRestricted(realRelFromRoot)) {
            return true;
          }
        } catch {
          // Path doesn't exist yet or is broken symlink, skip
        }
        
        // If it's a directory, recurse using the real path
        if (entry.isDirectory()) {
          try {
            const realFullPath = realpathWithMissingSuffix(fullPath);
            const realEntryRelFromRoot = path.relative(this.realRoot(), realFullPath);
            if (await walk(realFullPath, realEntryRelFromRoot)) {
              return true;
            }
          } catch {
            // Can't resolve real path, use lexical path
            if (await walk(fullPath, entryRelFromRoot)) {
              return true;
            }
          }
        } else if (entry.isSymbolicLink()) {
          // For symlinks to directories, recurse into the target
          try {
            const realPath = await fsPromises.realpath(fullPath);
            const stat = await fsPromises.stat(realPath);
            if (stat.isDirectory()) {
              const realRelFromRoot = path.relative(this.realRoot(), realPath);
              if (await walk(realPath, realRelFromRoot)) {
                return true;
              }
            }
          } catch {
            // Broken symlink, skip
          }
        }
      }
      return false;
    };
    
    return walk(realDirPath, relFromRoot);
  }

  private realRoot(): string {
    return (this.#realRoot ??= realpathWithMissingSuffix(this.root));
  }
}

// In memory for the life of the process; index.ts resets it to "on" at every session start.
let state: SandboxState = "on";

export function getSandboxState(): SandboxState {
  return state;
}

export function setSandboxState(next: SandboxState): void {
  state = next;
}

/** The sandbox for one tool call, snapshotting the current state. */
export function sandboxFor(root: string): Sandbox {
  return new Sandbox(root, state === "on");
}

/**
 * Real path of `target`, resolving its nearest existing ancestor and re-attaching the parts that
 * don't exist yet (a file about to be created). Falls back to `target` if nothing exists.
 */
function realpathWithMissingSuffix(target: string): string {
  const missing: string[] = [];
  let current = target;
  while (true) {
    try {
      return path.join(fs.realpathSync(current), ...missing);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      const parent = path.dirname(current);
      if (parent === current) return target;
      missing.unshift(path.basename(current));
      current = parent;
    }
  }
}

function realpathOrUndefined(target: string): string | undefined {
  try {
    return fs.realpathSync(target);
  } catch {
    return undefined;
  }
}
