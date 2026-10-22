import * as fs from "node:fs/promises";
import * as path from "node:path";
import fg from "fast-glob";
import type { Sandbox } from "../sandbox/sandbox.ts";

export type InstallLanguage = "typescript" | "python" | "dotnet";

// Official name grammars. Anything that is not a plain registry name — local
// paths, wheels, tarballs, file: specs, git+ URLs, http URLs, shell
// metacharacters — fails these before any command runs.
const NPM_NAME = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i;
const PYPI_NAME = /^([A-Za-z0-9][A-Za-z0-9._-]*[A-Za-z0-9]|[A-Za-z0-9])$/;
const NUGET_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
// A version is digits and npm-range punctuation only; no shell or path syntax.
const VERSION_RE = /^[\w.+-]+$/;
// Marker substrings that no plain registry name can contain.
const FORBIDDEN_SUBSTRINGS = ["://", "file:", "git+", "ssh:", "../", "..\\", "./", ".\\"];
// Local package artifact extensions — installable files are never registry names.
const LOCAL_ARTIFACT_RE = /\.(whl|tar\.gz|tgz|nupkg|zip|gz|dll|so|exe)$/i;

export function registryName(language: InstallLanguage): string {
  return language === "typescript" ? "npm" : language === "python" ? "PyPI" : "NuGet";
}

export function validateName(language: InstallLanguage, name: string): void {
  if (name !== name.trim() || name === "") {
    throw new Error("Package name must not be empty or have surrounding whitespace.");
  }
  const lower = name.toLowerCase();
  if (LOCAL_ARTIFACT_RE.test(lower)) {
    throw new Error(`"${name}" looks like a local package file. Only officially registered packages can be installed.`);
  }
  for (const bad of FORBIDDEN_SUBSTRINGS) {
    if (lower.includes(bad)) {
      throw new Error(`"${name}" is not an official registry package name (local paths, files and URLs are not allowed).`);
    }
  }
  if (/[\\]/.test(name) || path.isAbsolute(name)) {
    throw new Error(`"${name}" is not an official registry package name (paths are not allowed).`);
  }
  if (/[\s"'`$;&|<>!?~#(){}\[\]]/.test(name)) {
    throw new Error(`"${name}" contains characters that are not allowed in a package name.`);
  }
  const grammar = language === "typescript" ? NPM_NAME : language === "python" ? PYPI_NAME : NUGET_NAME;
  if (!grammar.test(name)) {
    throw new Error(`"${name}" is not a valid ${registryName(language)} package name.`);
  }
}

export function validateVersion(version: string): void {
  if (!VERSION_RE.test(version)) {
    throw new Error(`"${version}" is not a valid version specifier.`);
  }
}

/** Detects the languages present in the project root (unambiguous = exactly one). */
export async function detectLanguage(root: string, signal?: AbortSignal): Promise<InstallLanguage[] | undefined> {
  signal?.throwIfAborted();
  const has = async (pattern: string) => (await fg(pattern, { cwd: root, onlyFiles: true, dot: true })).length > 0;
  const pkgJson = await fs.stat(path.join(root, "package.json")).then(() => true, () => false);
  const [csproj, py] = await Promise.all([has("*.csproj"), has("*.py")]);
  const found: InstallLanguage[] = [];
  if (pkgJson) found.push("typescript");
  if (csproj) found.push("dotnet");
  if (py) found.push("python");
  return found.length > 0 ? found : undefined;
}

/** The single .NET project in the sandbox root, or undefined when there isn't exactly one. */
export async function singleDotnetProject(sb: Sandbox, signal?: AbortSignal): Promise<string | undefined> {
  signal?.throwIfAborted();
  const patterns = ["*.csproj", "*.fsproj", "*.vbproj"];
  const matches: string[] = [];
  for (const pattern of patterns) {
    matches.push(...(await fg(pattern, { cwd: sb.resolve("."), onlyFiles: true, dot: true })));
  }
  if (matches.length !== 1) return undefined;
  return path.join(sb.resolve("."), matches[0]!);
}
