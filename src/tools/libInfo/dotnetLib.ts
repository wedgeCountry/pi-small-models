import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import fg from "fast-glob";
import { resolveSandboxPath, resolveLibraryPath } from "../../sandbox.ts";
import type { ApiEntry, LibExtraction, LibraryInfo } from "./types.ts";
import { displayPath, isDirectory, isFile, realpathOr } from "./paths.ts";
import { parseXmlDocMembers, xmlDocsToEntries } from "./xmlDocs.ts";

const NUGET_ID = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;
const PROJECT_EXTS = [".csproj", ".fsproj", ".vbproj"];
const MAX_PROJECTS = 50;
const MAX_FRAMEWORK_SCAN_FILES = 5;

export interface DotnetLibOptions {
  /** Project file, solution, or directory (relative to the project root) to resolve against. */
  project?: string;
  /** Target framework, e.g. "net8.0". Defaults to the project's first. */
  tfm?: string;
  /** Namespace to scope the overview to. */
  module?: string;
  /** Tests only: .NET install directories to search for framework reference packs. */
  dotnetRoots?: string[];
  signal?: AbortSignal;
}

interface AssetsLibrary {
  type?: string;
  path?: string;
  files?: string[];
}
interface AssetsTargetEntry {
  type?: string;
  dependencies?: Record<string, string>;
  compile?: Record<string, unknown>;
  frameworkReferences?: string[];
}
interface AssetsFile {
  targets?: Record<string, Record<string, AssetsTargetEntry>>;
  libraries?: Record<string, AssetsLibrary>;
  packageFolders?: Record<string, unknown>;
  project?: {
    restore?: { projectPath?: string };
    frameworks?: Record<string, { targetAlias?: string; frameworkReferences?: Record<string, unknown> }>;
  };
}

/** ".NETCoreApp,Version=v8.0" → "net8.0"; "net8.0" stays. */
export function shortTfm(target: string): string {
  const m = /^\.(NETCoreApp|NETStandard|NETFramework),Version=v(\d+)\.(\d+)(?:\.(\d+))?/.exec(target);
  if (!m) return target.split("/")[0]!;
  const [, fw, major, minor, patch] = m;
  if (fw === "NETStandard") return `netstandard${major}.${minor}`;
  if (fw === "NETFramework") return `net${major}${minor}${patch ?? ""}`;
  return Number(major) >= 5 ? `net${major}.${minor}` : `netcoreapp${major}.${minor}`;
}

function readJson<T>(file: string): T | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")) as T;
  } catch {
    return undefined;
  }
}

/** Project files referenced by a .sln (classic text) or .slnx (XML). */
function projectsInSolution(slnPath: string): string[] {
  const text = fs.readFileSync(slnPath, "utf8");
  const rels = [
    ...[...text.matchAll(/^Project\("[^"]*"\)\s*=\s*"[^"]*",\s*"([^"]+)"/gm)].map((m) => m[1]!),
    ...[...text.matchAll(/<Project\s+Path="([^"]+)"/g)].map((m) => m[1]!),
  ];
  return rels
    .map((r) => r.replace(/\\/g, "/"))
    .filter((r) => PROJECT_EXTS.some((e) => r.endsWith(e)))
    .map((r) => path.resolve(path.dirname(slnPath), r));
}

/** Candidate project files: the given one, those in a given solution/dir, or all under the root. */
function findProjects(root: string, project: string | undefined): string[] {
  const target = project ? resolveSandboxPath(root, project, "read") : root;
  if (isFile(target)) {
    if (PROJECT_EXTS.some((e) => target.endsWith(e))) return [target];
    if (/\.slnx?$/.test(target)) {
      return projectsInSolution(target).filter((p) => {
        try {
          return isFile(resolveSandboxPath(root, p, "read"));
        } catch {
          return false; // outside the project root / restricted
        }
      });
    }
    throw new Error(`"${project}" is not a project (.csproj/.fsproj/.vbproj) or solution (.sln/.slnx) file`);
  }
  if (!isDirectory(target)) throw new Error(`"${project}" does not exist`);
  return fg
    .sync(PROJECT_EXTS.map((e) => `**/*${e}`), {
      cwd: target,
      absolute: true,
      deep: 5,
      ignore: ["**/bin/**", "**/obj/**", "**/node_modules/**", "**/.git/**"],
      followSymbolicLinks: false,
    })
    .sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b))
    .slice(0, MAX_PROJECTS);
}

/** obj/project.assets.json for a project (also the artifacts/obj layout of UseArtifactsOutput). */
function assetsFor(root: string, projectFile: string): string | undefined {
  const name = path.basename(projectFile).replace(/\.[^.]+$/, "");
  const candidates = [path.join(path.dirname(projectFile), "obj", "project.assets.json"), path.join(root, "artifacts", "obj", name, "project.assets.json")];
  return candidates.find((c) => {
    try {
      return isFile(resolveSandboxPath(root, path.relative(root, c), "read"));
    } catch {
      return false;
    }
  });
}

/** Installed .NET roots, for framework reference packs (System.*). */
export function dotnetRoots(): string[] {
  const out = new Set<string>();
  for (const v of [process.env.DOTNET_ROOT, process.env["DOTNET_ROOT(x86)"], process.env.DOTNET_ROOT_X64]) if (v) out.add(v);
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    for (const exe of ["dotnet", "dotnet.exe"]) {
      const p = path.join(dir, exe);
      if (isFile(p)) out.add(path.dirname(realpathOr(p)));
    }
  }
  const home = os.homedir();
  for (const d of ["/usr/share/dotnet", "/usr/lib/dotnet", "/usr/local/share/dotnet", "/opt/dotnet", path.join(home, ".dotnet"), "C:\\Program Files\\dotnet"]) out.add(d);
  return [...out].filter((d) => isDirectory(path.join(d, "packs")));
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

/** `packs/<Framework>.Ref/<version>/ref/<tfm>` directories, best version for the tfm first. */
function refPackDirs(roots: string[], frameworks: string[], tfm: string): string[] {
  const major = /^net(\d+)\./.exec(tfm)?.[1];
  const out: string[] = [];
  for (const root of roots) {
    for (const fw of frameworks) {
      const packDir = path.join(root, "packs", `${fw}.Ref`);
      if (!isDirectory(packDir)) continue;
      const versions = fs.readdirSync(packDir).filter((v) => isDirectory(path.join(packDir, v)));
      const preferred = versions.filter((v) => !major || v.split(".")[0] === major).sort(compareVersions).reverse();
      for (const v of preferred.length ? preferred : versions.sort(compareVersions).reverse()) {
        const refDir = path.join(packDir, v, "ref");
        if (!isDirectory(refDir)) continue;
        const tfms = fs.readdirSync(refDir).sort().reverse();
        const pick = tfms.find((t) => t === tfm) ?? tfms[0];
        if (pick) {
          out.push(path.join(refDir, pick));
          break;
        }
      }
    }
  }
  return out;
}

function nuspecInfo(text: string): { description?: string; projectUrl?: string } {
  const get = (tag: string) => new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`).exec(text)?.[1]?.trim();
  const repo = /<repository[^>]*\surl="([^"]+)"/.exec(text)?.[1];
  const description = get("description") ?? get("summary");
  return { description: description?.replace(/\s+/g, " "), projectUrl: get("projectUrl") ?? repo };
}

interface Located {
  kind: "package" | "framework";
  id: string;
  version?: string;
  pkgDir?: string;
  xmlFiles: string[];
  /** Assemblies that ship no XML docs. */
  undocumented: string[];
  dependencies: string[];
  summary?: string;
  notes: string[];
  libRoots: string[];
  /** For a framework namespace lookup, the namespace to scope to. */
  impliedModule?: string;
}

/**
 * Finds `pkg` among a project's restored packages (obj/project.assets.json) — or, for System.* /
 * Microsoft.* names not in the assets file, in the SDK's framework reference packs — and returns
 * the XML doc files that document its compile-time assemblies.
 */
function locate(root: string, pkg: string, opts: DotnetLibOptions): Located & { project: string; tfm: string; tfms: string[] } {
  const projects = findProjects(root, opts.project);
  if (projects.length === 0) throw new Error("No .NET project (.csproj/.fsproj/.vbproj) found under the project root. Pass project= to point at one.");

  const restored: { project: string; assets: AssetsFile; assetsPath: string }[] = [];
  for (const p of projects) {
    const a = assetsFor(root, p);
    const assets = a && readJson<AssetsFile>(a);
    if (assets) restored.push({ project: p, assets, assetsPath: a! });
  }
  if (restored.length === 0) {
    throw new Error(`No obj/project.assets.json found for ${projects.map((p) => displayPath(root, p)).join(", ")}. Restore/build first (dotnet_build), then retry.`);
  }

  const lower = pkg.toLowerCase();
  for (const { project, assets } of restored) {
    const targetKeys = Object.keys(assets.targets ?? {}).filter((k) => !k.includes("/"));
    const tfms = targetKeys.map(shortTfm);
    let targetKey = targetKeys[0];
    if (opts.tfm) {
      const i = tfms.findIndex((t) => t.toLowerCase() === opts.tfm!.toLowerCase());
      if (i < 0) throw new Error(`Target framework "${opts.tfm}" not in ${displayPath(root, project)} (has: ${tfms.join(", ")})`);
      targetKey = targetKeys[i];
    }
    if (!targetKey) continue;
    const tfm = shortTfm(targetKey);
    const target = assets.targets![targetKey]!;
    const libKey = Object.keys(assets.libraries ?? {}).find((k) => k.split("/")[0]!.toLowerCase() === lower);
    const base = { project, tfm, tfms };

    if (libKey) {
      const [id, version] = libKey.split("/") as [string, string];
      const lib = assets.libraries![libKey]!;
      const entry = target[libKey] ?? {};
      const dependencies = Object.entries(entry.dependencies ?? {}).map(([n, v]) => `${n} ${v}`);
      if (lib.type === "project") {
        throw new Error(`${id} is a project in this repository (${lib.path ?? "?"}), not a NuGet package — read its source with peek/find instead.`);
      }
      const packageFolders = Object.keys(assets.packageFolders ?? {});
      const pkgDir = packageFolders.map((f) => path.join(f, lib.path ?? `${lower}/${version.toLowerCase()}`)).find(isDirectory);
      if (!pkgDir) {
        throw new Error(`${id} ${version} is referenced but not found in the package folders (${packageFolders.join(", ") || "none"}). Restore first (dotnet_build).`);
      }
      const libRoots = packageFolders;
      const files = lib.files ?? [];
      const dlls = Object.keys(entry.compile ?? {}).filter((f) => f.endsWith(".dll"));
      const xmlFiles: string[] = [];
      const undocumented: string[] = [];
      for (const dll of dlls) {
        const asm = path.posix.basename(dll, ".dll");
        const sameDir = dll.replace(/\.dll$/, ".xml");
        const candidates = [sameDir, ...files.filter((f) => f.toLowerCase().endsWith(`/${asm.toLowerCase()}.xml`) && /^(lib|ref)\//.test(f))];
        const found = candidates.map((c) => path.join(pkgDir, c)).find(isFile);
        if (found) xmlFiles.push(resolveLibraryPath(libRoots, found));
        else undocumented.push(dll);
      }
      const nuspecFile = files.find((f) => f.endsWith(".nuspec"));
      let summary: string | undefined;
      const notes: string[] = [];
      if (nuspecFile && isFile(path.join(pkgDir, nuspecFile))) {
        const n = nuspecInfo(fs.readFileSync(resolveLibraryPath(libRoots, path.join(pkgDir, nuspecFile)), "utf8"));
        summary = n.description;
        if (n.projectUrl) notes.push(`Project URL: ${n.projectUrl}`);
      }
      if (dlls.length === 0) notes.push(`${id} has no compile-time assemblies for ${tfm} (a meta-package or build-only package); see its dependencies.`);
      return { ...base, kind: "package", id, version, pkgDir, xmlFiles, undocumented, dependencies, summary, notes, libRoots };
    }

    // Not a package: maybe a framework assembly or namespace (System.Text.Json, System.Linq, …).
    if (/^(System|Microsoft)(\.|$)/i.test(pkg)) {
      const alias = Object.entries(assets.project?.frameworks ?? {}).find(([k, v]) => shortTfm(v.targetAlias ?? k) === tfm || k === tfm)?.[1];
      const frameworks = ["Microsoft.NETCore.App", ...Object.keys(alias?.frameworkReferences ?? {})];
      const roots = opts.dotnetRoots ?? dotnetRoots();
      const refDirs = refPackDirs(roots, [...new Set(frameworks)], tfm);
      const libRoots = roots.map((r) => path.join(r, "packs"));
      for (const dir of refDirs) {
        const asmXml = fs.readdirSync(dir).find((f) => f.toLowerCase() === `${lower}.xml`);
        if (asmXml) {
          const version = path.basename(path.dirname(path.dirname(dir)));
          return { ...base, kind: "framework", id: pkg, version, pkgDir: dir, xmlFiles: [resolveLibraryPath(libRoots, path.join(dir, asmXml))], undocumented: [], dependencies: [], notes: [`Part of the shared framework (${path.basename(path.dirname(path.dirname(path.dirname(dir))))}).`], libRoots };
        }
      }
      // A namespace rather than an assembly name: find the doc files that define types in it.
      const needle = `name="T:${pkg}.`;
      for (const dir of refDirs) {
        const hits: string[] = [];
        for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".xml"))) {
          const full = resolveLibraryPath(libRoots, path.join(dir, f));
          if (fs.readFileSync(full, "utf8").includes(needle)) hits.push(full);
          if (hits.length >= MAX_FRAMEWORK_SCAN_FILES) break;
        }
        if (hits.length) {
          const version = path.basename(path.dirname(path.dirname(dir)));
          return { ...base, kind: "framework", id: pkg, version, pkgDir: dir, xmlFiles: hits, undocumented: [], dependencies: [], notes: [`Namespace ${pkg} of the shared framework, documented in ${hits.map((h) => path.basename(h, ".xml")).join(", ")}.`], libRoots, impliedModule: pkg };
        }
      }
      if (refDirs.length === 0 && /^System(\.|$)/i.test(pkg)) {
        throw new Error(`"${pkg}" looks like a framework assembly, but no .NET SDK reference packs were found (set DOTNET_ROOT).`);
      }
    }
  }

  const known = restored.flatMap(({ assets }) => Object.entries(assets.libraries ?? {}).filter(([, v]) => v.type === "package").map(([k]) => k.split("/")[0]!));
  const list = [...new Set(known)].sort();
  throw new Error(
    `Package "${pkg}" is not referenced by ${restored.map((r) => displayPath(root, r.project)).join(", ")}.` +
      (list.length ? ` Restored packages: ${list.slice(0, 40).join(", ")}${list.length > 40 ? ", …" : ""}.` : "") +
      " If you just added it, restore/build first (dotnet_build)."
  );
}

/**
 * Locates a NuGet package (or framework assembly/namespace) for a project and lists its API from
 * its XML documentation files. `module` scopes to one namespace.
 */
export async function extractDotnetLibrary(root: string, pkg: string, opts: DotnetLibOptions = {}): Promise<LibExtraction> {
  opts.signal?.throwIfAborted();
  pkg = pkg.trim();
  if (!NUGET_ID.test(pkg) || pkg.includes("..")) throw new Error(`"${pkg}" is not a valid NuGet package id`);
  const absRoot = path.resolve(root);
  const loc = locate(absRoot, pkg, opts);
  opts.signal?.throwIfAborted();

  const entries: ApiEntry[] = [];
  const namespaces = new Set<string>();
  for (const file of loc.xmlFiles) {
    const xml = await fs.promises.readFile(file, { encoding: "utf8", signal: opts.signal });
    const r = xmlDocsToEntries(parseXmlDocMembers(xml), displayPath(absRoot, file));
    entries.push(...r.entries);
    r.namespaces.forEach((n) => namespaces.add(n));
  }
  const nsList = [...namespaces].sort();

  // Scope: explicit module, else a namespace named like the package, else the only namespace,
  // else the namespace list.
  let rootContainer = "";
  const module = opts.module?.trim() || loc.impliedModule;
  if (module) {
    const match = nsList.find((n) => n === module) ?? nsList.find((n) => n.toLowerCase() === module.toLowerCase());
    if (!match) throw new Error(`Namespace "${module}" not found in ${loc.id}. Namespaces: ${nsList.join(", ") || "(none)"}`);
    rootContainer = match;
  } else if (nsList.length === 1) {
    rootContainer = nsList[0]!;
  } else {
    rootContainer = nsList.find((n) => n.toLowerCase() === pkg.toLowerCase()) ?? "";
  }
  if (rootContainer === "") {
    for (const ns of nsList) {
      const count = entries.filter((e) => e.container === ns).length;
      entries.push({ kind: "namespace", name: ns, container: "", signature: `namespace ${ns}  (${count} types)` });
    }
  }

  const notes = [
    `Target framework ${loc.tfm}${loc.tfms.length > 1 ? ` (project also targets ${loc.tfms.filter((t) => t !== loc.tfm).join(", ")}; pass tfm= to switch)` : ""}, from ${displayPath(absRoot, loc.project)}.`,
    ...loc.notes,
  ];
  if (loc.xmlFiles.length) {
    notes.push("Signatures are rebuilt from XML documentation IDs: parameter types and names are exact, but return types, modifiers (static, async, out/in vs ref) and undocumented members are missing; class/interface/enum is inferred. Docs show what methods return.");
  }
  if (loc.undocumented.length) {
    notes.push(`No XML documentation ships for ${loc.undocumented.join(", ")}, so ${loc.xmlFiles.length ? "those assemblies' APIs" : "its API"} can't be listed — check the package's online docs or its source repository.`);
  }

  const info: LibraryInfo = {
    ecosystem: "nuget",
    name: loc.id,
    version: loc.version,
    location: loc.pkgDir ? displayPath(absRoot, loc.pkgDir) : undefined,
    apiSource: loc.xmlFiles.map((f) => displayPath(absRoot, f)),
    summary: loc.summary,
    dependencies: loc.dependencies.length ? loc.dependencies : undefined,
    modules: nsList.length > 1 ? nsList : undefined,
    module: rootContainer || undefined,
    notes,
  };
  return { info, entries, rootContainer };
}
