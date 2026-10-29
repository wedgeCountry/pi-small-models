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
  "**/.git/**",
  "**/.git",
  "**/.git*",
  "**/.git.*",
  "**/.git.**",
  "**/.*git*",
  "**/*/.git.",
  "**/*/.git...",
  "**/*/..git",
  "**/*/...git",
  "**/..git/**",
  "**/...git",
  "**/...git/**",
  "**/.git..",
  "**/.git...",
  "**/..git.",
  "**/...git.",
  "**/.git-credentials",
  "**/.venv/**",
  "**/.venv",
  "**/.venv*",
  "**/.venv.*",
  "**/.venv..",
  "**/.venv...",
  "**/..venv",
  "**/...venv",
  "**/*/.venv.",
  "**/*/.venv...",
  "**/*/..venv",
  "**/*/...venv",
  "**/node_modules/**",
  "**/node_modules",
  "**/node_modules*",
  "**/node_modules.**",
  "**/node_modules..",
  "**/node_modules...",
  "**/..node_modules",
  "**/...node_modules",
  "**/*/node_modules.",
  "**/*/node_modules...",
  "**/*/..node_modules",
  "**/*/...node_modules",
  "**/.node-repl-history",
  "**/bower_components/**",
  "**/bower_components",
  "**/bower_components*",
  "**/bower_components.*",
  "**/bower_components..",
  "**/bower_components...",
  "**/..bower_components",
  "**/...bower_components",
  "**/jspm_packages/**",
  "**/jspm_packages",
  "**/jspm_packages*",
  "**/jspm_packages.*",
  "**/jspm_packages..",
  "**/jspm_packages...",
  "**/..jspm_packages",
  "**/...jspm_packages",
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

// Security-critical paths must be matched case-insensitively on ALL platforms
// to prevent bypasses like .GIT, .Git, NODE_MODULES, etc.
// Windows and default macOS filesystems ignore case; Linux does not but we
// still need case-insensitive matching for security.
const MATCH_OPTIONS = {
  dot: true,
  nocase: true,
};

/** True if `relPath` (relative to a root, any separator) falls under a protected pattern. */
export function isRestricted(relPath: string): boolean {
  const posix = relPath.split(path.sep).join("/");
  return posix !== "" && picomatch.isMatch(posix, RESTRICTED_GLOBS as string[], MATCH_OPTIONS);
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
