import * as fs from "node:fs";
import * as path from "node:path";
import { isInside, isRestricted } from "./policy.ts";

/**
 * The sandbox every tool goes through. A `Sandbox` is an unchangeable snapshot for one tool call:
 * a project root plus whether rules are enforced. Tools never check paths themselves — they ask
 * the sandbox to resolve a path the model gave (`resolve`), to filter what a directory walk found
 * (`entryFilter`), to filter paths another program reported (`allowsReported`), or to resolve a
 * file inside an installed package (`resolveLibraryFile`).
 *
 * When enforced, a path must stay inside its root and must not match `policy.ts`'s protected
 * patterns. Both are checked on the path as given and on its real, symlink-resolved location, so a
 * symlink can neither escape the root nor disguise a protected path. When not enforced, nothing is
 * checked and `permissionGate.ts` asks the user before each call instead.
 */

export type SandboxState = "on" | "off";

export class SandboxError extends Error {
  constructor(
    readonly reason: "outside-root" | "outside-libraries" | "restricted",
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
    return path.relative(this.root, this.resolve(target));
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
   * Resolves a file inside an installed package. The model never names these files; tools derive
   * `libRoots` from package-manager metadata. The file must really lie under one of the roots and
   * must not match a protected pattern relative to it. Read-only use only.
   */
  resolveLibraryFile(libRoots: readonly string[], target: string): string {
    const resolved = path.resolve(target);
    if (!this.enforced) return resolved;

    const real = realpathWithMissingSuffix(resolved);
    for (const libRoot of libRoots) {
      const lexicalRoot = path.resolve(libRoot);
      const realRelative = path.relative(realpathWithMissingSuffix(lexicalRoot), real);
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
      return false; // unreadable paths are refused rather than risked
    }
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
