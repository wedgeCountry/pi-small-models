import * as path from "node:path";
import picomatch from "picomatch";

/**
 * What the sandbox protects, as pure functions with no filesystem access. `sandbox.ts` decides
 * which paths to feed in; this file only says yes or no.
 *
 * Patterns are matched against POSIX paths relative to the project root, so
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
  "**/.config/gh/**",
  "**/id_rsa",
  "**/id_dsa",
  "**/id_ecdsa",
  "**/id_ed25519",
  "**/.git-credentials",
  "**/.node-repl-history",
  "**/.pypirc",
  "**/.yarnrc.yml",
  "**/server.pem",
  "**/private.key",
  "**/keystore.p12",
  "**/terraform.tfstate",
  "**/.terraform/**",
  "**/.pi/**",
  "**/.piignore",
  "**/AGENTS.md",
  "**/CLAUDE.md",
  "**/.agents/**",
];

/**
 * Directory names no path may pass through, checked per path segment (see `isRestricted`).
 * Replaces the former per-variant glob entries: any segment whose canonical form equals one of
 * these names is restricted, so lookalikes (`.git.`, `..git`, `.git...`, `NODE_MODULES`, …) are
 * covered by construction instead of by enumeration.
 */
export const RESTRICTED_DIR_NAMES: readonly string[] = [
  ".git",
  ".venv",
  "node_modules",
  "bower_components",
  "jspm_packages",
];

/**
 * Canonical form of a path segment for the directory-name check: lowercase, leading and
 * trailing dots stripped (`.git..` -> `git`, `..git` -> `git`, `..node_modules` ->
 * `node_modules`). Both the checked segment and `RESTRICTED_DIR_NAMES` go through this, so a
 * name matches regardless of dotted/case spelling.
 */
function canonicalSegment(segment: string): string {
  return segment.replace(/^\.+/, "").replace(/\.+$/, "").toLowerCase();
}

const RESTRICTED_DIR_NAMES_CANONICAL: readonly string[] = RESTRICTED_DIR_NAMES.map(canonicalSegment);

// Security-critical paths must be matched case-insensitively on ALL platforms
// to prevent bypasses like .GIT, .Git, NODE_MODULES, etc.
// Windows and default macOS filesystems ignore case; Linux does not but we
// still need case-insensitive matching for security.
const MATCH_OPTIONS = {
  dot: true,
  nocase: true,
};

/** True if `relPath` (relative to a root, any separator) is protected: either one of its path
 * segments is a restricted directory name (`.git`, `node_modules`, …, in any dotted/case
 * variation), or it matches a credential-file glob in `RESTRICTED_GLOBS`. */
export function isRestricted(relPath: string): boolean {
  const posix = relPath.split(path.sep).join("/");
  if (posix === "") return false;
  const dirHit = posix.split("/").some((segment) => RESTRICTED_DIR_NAMES_CANONICAL.includes(canonicalSegment(segment)));
  return dirHit || picomatch.isMatch(posix, RESTRICTED_GLOBS as string[], MATCH_OPTIONS);
}

/** True if `relPath` (from `path.relative`) stays inside its root: no `..` escape, not absolute.
 * Separator- and platform-agnostic: rejects `..` escapes written with either `/` or `\`, and
 * absolute paths in POSIX (`/etc`), Windows drive (`C:\\...`), or UNC (`\\\\server\\...`) form,
 * regardless of the platform the check runs on. */
export function isInside(relPath: string): boolean {
  const posix = relPath.split(/[\\/]/).join("/");
  return (
    !posix.split("/").includes("..") &&
    !path.isAbsolute(relPath) &&
    !posix.startsWith("/") &&
    !/^[A-Za-z]:/.test(posix)
  );
}
