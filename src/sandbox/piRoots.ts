import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Sandbox } from "./sandbox.ts";

/**
 * Read-only access to Pi's *own* files — its documentation/examples and the skills it discovered —
 * for the `pi_docs` and `pi_skills` tools.
 *
 * Those two tools are deliberately outside the project sandbox: Pi tells the model to read
 * `<agent-dir>/install/releases/<version>/node_modules/@earendil-works/pi-coding-agent/docs/...` or a
 * skill's `SKILL.md`, and both live outside the project root (and, in the docs' case, inside a
 * `node_modules` directory), which every project-rooted `Sandbox` rejects. That is a Pi-usage problem,
 * not a project problem, so instead of widening `policy.ts` for every tool these two get their own
 * fixed set of roots, discovered here.
 *
 * Two rules keep the escape hatch small:
 *
 * 1. **Roots never come from the model.** They are derived from Pi's documented layout
 *    (`agentDir` from `getAgentDir()`, the working directory from `ctx.cwd`, `os.homedir()`), so a
 *    model can only ever name a *relative sub-path* inside a root Pi already reads itself.
 * 2. **Every check still runs inside that root.** A root is handed to `readOnlySandbox()` — an always
 *    enforced `Sandbox` — so `resolve()`'s tilde/env-var/unicode/encoding rejections, its lexical *and*
 *    symlink-resolved containment checks, and `policy.ts` restrictions relative to that root (a skill
 *    folder's own `.git/`, `.env` or `node_modules/` stay off-limits) all apply as usual.
 */

/** Pi's own package name: its docs live inside the installed copy of this package. */
export const PI_PACKAGE_NAME = "@earendil-works/pi-coding-agent";

/**
 * Top-level entries of Pi's package `pi_docs` may reach. Everything else in the package (its `src/`,
 * `package.json`, own `node_modules/`) stays unreachable. The check is on the first path segment, so
 * `examples/../src/core/x.ts` — which stays inside the package root and so passes containment — is
 * still rejected here.
 */
export const PI_DOC_ENTRIES: readonly string[] = ["README.md", "CHANGELOG.md", "docs", "examples"];

/** Where one tool call may look. `homeDir` is injectable so tests never read the real `~/.agents`. */
export interface PiResourceRoots {
  /** Pi's agent directory (`getAgentDir()`, default `~/.pi/agent`). */
  agentDir: string;
  /** The session's working directory (`ctx.cwd`). */
  cwd: string;
  /** Home directory used for the Agent Skills location `~/.agents/skills`. Defaults to `os.homedir()`. */
  homeDir?: string;
}

export interface PiDocsLocation {
  /** Installed package root, e.g. `<agentDir>/install/releases/1.4.0/node_modules/@earendil-works/pi-coding-agent`. */
  packageRoot: string;
  /** Version from the package's `package.json`, or the `install/releases/<version>` directory name. */
  version: string;
  which: "install" | "npm" | "module";
  /** `PI_DOC_ENTRIES` that actually exist, as paths relative to `packageRoot`. */
  entries: string[];
}

export type SkillSource = "user" | "project" | "package";

export interface SkillLocation {
  /** Name from `SKILL.md` frontmatter (`name:`), falling back to the directory name. */
  name: string;
  /** One-line routing description from frontmatter, `""` when the file has none. */
  description: string;
  /** Directory containing `SKILL.md`. */
  dir: string;
  skillFile: string;
  source: SkillSource;
}

export interface SkillOptions {
  maxSkills?: number;
  /** How deep below a skills root to look for nested `SKILL.md` directories. Default 5. */
  maxDepth?: number;
}

// ============================================================================
// Read-only sandbox
// ============================================================================

/**
 * A `Sandbox` rooted at one of Pi's own read-only locations. Always enforced — with
 * `/toggle-sandbox off` the project tools stop checking paths and ask the user instead, but these
 * tools keep their containment, since their whole safety story is the fixed root.
 */
export function readOnlySandbox(root: string): Sandbox {
  return new Sandbox(root, true);
}

/** True if `relPath` (relative to a package root) starts with one of `PI_DOC_ENTRIES`. */
export function isPiDocPath(relPath: string): boolean {
  const first = relPath.split(/[\\/]+/)[0] ?? "";
  return PI_DOC_ENTRIES.some((entry) => entry.toLowerCase() === first.toLowerCase());
}

// ============================================================================
// Pi's own documentation
// ============================================================================

/**
 * Locate the installed copy of Pi's package, newest version first: `<agentDir>/install/releases/*`,
 * then `<agentDir>/npm/node_modules/@earendil-works/pi-coding-agent` (a package's declared host
 * package can also land there), then the copy this extension's own import of the SDK resolved to.
 * Candidates that exist but expose none of `PI_DOC_ENTRIES` are skipped.
 */
export async function discoverPiDocs(roots: PiResourceRoots): Promise<PiDocsLocation[]> {
  const found: PiDocsLocation[] = [];
  const seen = new Set<string>();

  const add = async (candidate: string | undefined, which: PiDocsLocation["which"]): Promise<void> => {
    if (!candidate) return;
    const absolute = path.resolve(candidate);
    if (seen.has(absolute)) return;
    seen.add(absolute);

    const entries = await existingDocEntries(absolute);
    if (entries.length === 0) return;
    found.push({ packageRoot: absolute, version: await packageVersion(absolute, which), which, entries });
  };

  const releasesDir = path.join(roots.agentDir, "install", "releases");
  for (const release of await subDirectoriesSortedDesc(releasesDir)) {
    await add(path.join(releasesDir, release, "node_modules", PI_PACKAGE_NAME), "install");
  }

  await add(path.join(roots.agentDir, "npm", "node_modules", PI_PACKAGE_NAME), "npm");
  await add(resolveSdkPackageRoot(), "module");

  return found;
}

/**
 * Package root of the SDK copy this file's own `@earendil-works/pi-coding-agent` import resolved to,
 * found by walking up from the resolved module path to the nearest `package.json`. Best-effort: Pi
 * maps host packages for extensions, and `import.meta.resolve` may legitimately fail, which only
 * costs the fallback.
 */
function resolveSdkPackageRoot(): string | undefined {
  let url: string | undefined;
  try {
    url = import.meta.resolve(PI_PACKAGE_NAME);
  } catch {
    return undefined;
  }
  if (!url || !url.startsWith("file:")) return undefined;

  let dir = path.dirname(fileURLToPath(url));
  for (let depth = 0; depth < 12; depth++) {
    if (dir === path.dirname(dir)) break;
    if (path.basename(dir) === path.basename(PI_PACKAGE_NAME)) return dir;
    dir = path.dirname(dir);
  }
  return undefined;
}

async function existingDocEntries(packageRoot: string): Promise<string[]> {
  const present: string[] = [];
  for (const entry of PI_DOC_ENTRIES) {
    if (await isPath(path.join(packageRoot, entry))) present.push(entry);
  }
  return present;
}

async function packageVersion(packageRoot: string, which: PiDocsLocation["which"]): Promise<string> {
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(packageRoot, "package.json"), "utf8"));
    if (typeof manifest?.version === "string" && manifest.version !== "") return manifest.version;
  } catch {
    // fall through to the path heuristic below
  }
  if (which === "install") {
    // .../install/releases/<version>/node_modules/@earendil-works/pi-coding-agent
    const parts = packageRoot.split(path.sep);
    const version = parts[parts.length - 3];
    if (parts[parts.length - 2] === "node_modules" && version) return version;
  }
  return "unknown";
}

// ============================================================================
// Discovered skills
// ============================================================================

/**
 * Skills Pi can load, from Pi's documented locations: `<agentDir>/skills`, `~/.agents/skills`,
 * `<agentDir>/npm/node_modules/<pkg>/skills` (one level of package names, including `@scope`), and
 * the project's `.agents/skills` plus `.pi/skills`, walked from `cwd` up through its ancestors and
 * stopping at the repository root (the directory that owns `.git`).
 *
 * Name collisions are kept — `pi_skills` reports them instead of silently picking one — and the scan
 * is read-only and bounded (`maxSkills`, `maxDepth`).
 */
export async function discoverSkills(roots: PiResourceRoots, opts: SkillOptions = {}): Promise<SkillLocation[]> {
  const maxSkills = opts.maxSkills ?? 200;
  const maxDepth = opts.maxDepth ?? 5;
  const skills: SkillLocation[] = [];
  const visitedRealDirs = new Set<string>();

  const scanSkillsRoot = async (dir: string, source: SkillSource, depth: number): Promise<void> => {
    if (skills.length >= maxSkills) return;
    if (!(await isDirectory(dir))) return;

    const realDir = await realpathOrSelf(dir);
    if (visitedRealDirs.has(realDir)) return;
    visitedRealDirs.add(realDir);

    if (await isPath(path.join(dir, "SKILL.md"))) {
      skills.push(await readSkillLocation(dir, source));
      if (skills.length >= maxSkills) return;
    }

    if (depth >= maxDepth) return;
    for (const child of await subDirectoriesSortedAsc(dir)) {
      // A skill folder's own dependency or VCS directories are never skill candidates, and
      // `policy.ts` would reject them as a read target anyway.
      if (child === "node_modules" || child === ".git" || child === ".venv") continue;
      await scanSkillsRoot(path.join(dir, child), source, depth + 1);
      if (skills.length >= maxSkills) return;
    }
  };

  await scanSkillsRoot(path.join(roots.agentDir, "skills"), "user", 0);
  await scanSkillsRoot(path.join(roots.homeDir ?? os.homedir(), ".agents", "skills"), "user", 0);

  const projectRoots = await projectSkillRoots(roots.cwd);
  for (const root of projectRoots) await scanSkillsRoot(root, "project", 0);

  const npmDir = path.join(roots.agentDir, "npm", "node_modules");
  for (const scopeOrPackage of await subDirectoriesSortedAsc(npmDir)) {
    const packages = scopeOrPackage.startsWith("@")
      ? (await subDirectoriesSortedAsc(path.join(npmDir, scopeOrPackage))).map((pkg) => `${scopeOrPackage}/${pkg}`)
      : [scopeOrPackage];
    for (const pkg of packages) {
      // Conventional package layout (`<pkg>/skills`); a `pi.skills` manifest may point elsewhere,
      // which Pi resolves itself — `pi_skills` reads the same dirs Pi advertises skills from, so a
      // manifest-only location simply shows up as absent here.
      await scanSkillsRoot(path.join(npmDir, pkg, "skills"), "package", 0);
      if (skills.length >= maxSkills) break;
    }
  }

  return skills;
}

/** `<ancestors>/.agents/skills` and `<ancestors>/.pi/skills`, from `cwd` up to the repository root. */
async function projectSkillRoots(cwd: string): Promise<string[]> {
  const roots: string[] = [];
  let dir = path.resolve(cwd);
  let depth = 0;

  while (depth < 12) {
    roots.push(path.join(dir, ".agents", "skills"), path.join(dir, ".pi", "skills"));
    // The repository root is the last directory Pi scans (`AGENTS.md`-style ancestor walking stops
    // there), so stop as soon as this directory owns a `.git`.
    if (await isPath(path.join(dir, ".git"))) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
    depth++;
  }

  return roots;
}

async function readSkillLocation(dir: string, source: SkillSource): Promise<SkillLocation> {
  const frontmatter = await readFrontmatter(path.join(dir, "SKILL.md"));
  return {
    name: frontmatter.name || path.basename(dir),
    description: frontmatter.description,
    dir,
    skillFile: path.join(dir, "SKILL.md"),
    source,
  };
}

/**
 * `name` and `description` from the leading `---` frontmatter block of a `SKILL.md`: read the head of
 * the file, take the lines up to the closing `---`, and keep the single-line values Pi's own parser
 * needs for routing. Multi-line or structured values are ignored rather than guessed at.
 */
async function readFrontmatter(filePath: string, maxBytes = 16 * 1024): Promise<{ name: string; description: string }> {
  let head: string;
  try {
    const handle = await fs.open(filePath, "r");
    try {
      const buffer = Buffer.alloc(maxBytes);
      const { bytesRead } = await handle.read(buffer, 0, maxBytes, null);
      head = buffer.toString("utf8", 0, bytesRead);
    } finally {
      await handle.close();
    }
  } catch {
    return { name: "", description: "" };
  }

  const lines = head.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return { name: "", description: "" };

  const result = { name: "", description: "" };
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "---") break;
    const match = /^(name|description)\s*:\s*(.*)$/.exec(line);
    if (!match) continue;
    const value = (match[2] ?? "").trim().replace(/^["'](.*)["']$/, "$1");
    if (value !== "" && !result[match[1] as "name" | "description"]) result[match[1] as "name" | "description"] = value;
  }
  return result;
}

// ============================================================================
// Session cache for the registered tools
// ============================================================================

/**
 * Discovery results for the registered tools only; the plain functions above always re-scan so tests
 * and repeated calls stay deterministic. Skills change mid-session (`/reload`, granting project trust,
 * `pi install`, a new session in another directory), so the cache is cleared by
 * `resetSkillsCache()`, which `index.ts` calls on `session_start`.
 */
const skillCache = new Map<string, SkillLocation[]>();

export async function discoverSkillsCached(roots: PiResourceRoots, opts: SkillOptions = {}): Promise<SkillLocation[]> {
  const key = `${roots.agentDir}\u0000${roots.cwd}\u0000${roots.homeDir ?? os.homedir()}`;
  const cached = skillCache.get(key);
  if (cached) return cached;
  const skills = await discoverSkills(roots, opts);
  skillCache.set(key, skills);
  return skills;
}

export function resetSkillsCache(): void {
  skillCache.clear();
}

// ============================================================================
// Small filesystem helpers (all tolerant of missing paths)
// ============================================================================

async function isPath(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await fs.stat(target)).isDirectory();
  } catch {
    return false;
  }
}

async function realpathOrSelf(target: string): Promise<string> {
  try {
    return await fs.realpath(target);
  } catch {
    return target;
  }
}

async function subDirectoriesSortedAsc(dir: string): Promise<string[]> {
  const names = await readDirectoryNames(dir);
  return names.sort((a, b) => a.localeCompare(b, "en"));
}

async function subDirectoriesSortedDesc(dir: string): Promise<string[]> {
  const names = await readDirectoryNames(dir);
  // `numeric: true` keeps 1.10.0 above 1.9.0, which a plain string sort gets wrong.
  return names.sort((a, b) => b.localeCompare(a, "en", { numeric: true }));
}

async function readDirectoryNames(dir: string): Promise<string[]> {
  try {
    const entries = await fs.opendir(dir);
    const names: string[] = [];
    for await (const entry of entries) {
      if (entry.isDirectory()) {
        names.push(entry.name);
        continue;
      }
      // A symlinked directory counts too: Pi's own installs (a linked extension package, a linked
      // release) are often symlinks, and missing those would hide skills from the model.
      if (entry.isSymbolicLink() && (await isDirectory(path.join(dir, entry.name)))) names.push(entry.name);
    }
    return names;
  } catch {
    return [];
  }
}
