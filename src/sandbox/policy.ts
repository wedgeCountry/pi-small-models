import * as path from "node:path";
import micromatch from "micromatch";

/**
 * What the sandbox protects, as pure functions with no filesystem access. `sandbox.ts` decides
 * which paths to feed in; this file only says yes or no.
 *
 * Patterns are matched against POSIX paths relative to the project root (or a library root), so
 * the same list works on every platform. Every pattern starts with `**` so it applies at any depth.
 *
 * - Credential stores a project can contain: SSH keys (in `.ssh/` and loose), cloud CLI
 *   credentials (`.aws`, `.config/gcloud`), container/cluster config (`.docker`, `.kube`),
 *   package-manager tokens (`.npmrc`), GPG keyrings, and `.env*`/`.netrc`/`.pgpass`.
 * - `.git/**`: `.git/config` often embeds credentials in remote URLs, and `.git/objects` can keep
 *   secrets long deleted from the working tree. Public keys (`id_rsa.pub`) stay readable.
 */
export const RESTRICTED_GLOBS: readonly string[] = [
  "**/.ssh/**",
  "**/.aws/**",
  "**/.env*",
  "**/.netrc",
  "**/.npmrc",
  "**/.pgpass",
  "**/.docker/**",
  "**/.kube/**",
  "**/.gnupg/**",
  "**/.config/gcloud/**",
  "**/id_rsa",
  "**/id_dsa",
  "**/id_ecdsa",
  "**/id_ed25519",
  "**/.git/**",
];

// Windows and default macOS filesystems ignore case (".SSH" is ".ssh"); Linux does not.
const MATCH_OPTIONS = {
  dot: true,
  nocase: process.platform === "win32" || process.platform === "darwin",
};

/** True if `relPath` (relative to a root, any separator) falls under a protected pattern. */
export function isRestricted(relPath: string): boolean {
  const posix = relPath.split(path.sep).join("/");
  return posix !== "" && micromatch.isMatch(posix, RESTRICTED_GLOBS as string[], MATCH_OPTIONS);
}

/** True if `relPath` (from `path.relative`) stays inside its root: no `..` escape, not absolute. */
export function isInside(relPath: string): boolean {
  return relPath !== ".." && !relPath.startsWith(`..${path.sep}`) && !path.isAbsolute(relPath);
}
