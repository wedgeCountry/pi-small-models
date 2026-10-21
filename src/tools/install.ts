import * as fs from "node:fs/promises";
import * as path from "node:path";
import fg from "fast-glob";
import { INSTALL_TOOL_DEFINITION } from "../tool_definitions/install.ts";
import type { ToolRegistry } from "../sandbox/permissionGate.ts";
import { sandboxFor, type Sandbox } from "../sandbox/sandbox.ts";
import { oneLine, callName } from "../backend/renderCall.ts";
import { withConciseValidationErrors } from "../backend/toolValidation.ts";
import { runCommand, CommandNotFoundError, describeCommandError } from "../commands/runCommand.ts";
import { findPythonInterpreter, PYTHON_ENV_VAR } from "./libInfo/pythonLib.ts";

const MAX_BUFFER = 10 * 1024 * 1024;
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;

export type InstallLanguage = "typescript" | "python" | "dotnet";

export interface InstallOptions {
  /** Official registry package name (validated against the ecosystem grammar). */
  package: string;
  /** Version: npm range or exact pip/NuGet version. Omit for latest. */
  version?: string;
  /** Pin the ecosystem. Omit to detect from the project. */
  language?: InstallLanguage;
  /** npm only: install as a devDependency. */
  dev?: boolean;
  /** dotnet only: target project. Defaults to the single project in the root. */
  project?: string;
  signal?: AbortSignal;
  /** Tests only: inject registry lookup and command execution. */
  deps?: Partial<InstallDeps>;
}

export interface InstallDeps {
  /** Checks the package exists on the official registry; returns the available versions (empty = unknown list). */
  registryLookup: (language: InstallLanguage, name: string, signal?: AbortSignal) => Promise<RegistryInfo>;
  /** Runs the ecosystem's install command. */
  runInstall: (language: InstallLanguage, args: string[], opts: { cwd: string; signal?: AbortSignal }) => Promise<InstallRunResult>;
  fetchJson: (url: string, signal?: AbortSignal) => Promise<unknown>;
}

export interface RegistryInfo {
  exists: boolean;
  /** Known versions, when the registry lists them (npm and NuGet do; PyPI via requires_dist may not). */
  versions?: string[];
}

export interface InstallRunResult {
  success: boolean;
  output: string;
}

export interface InstallResult {
  success: boolean;
  language?: InstallLanguage;
  output: string;
}

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

function validateName(language: InstallLanguage, name: string): void {
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
  if (/[\s"'`$;&|<>!*?~#(){}\[\]]/.test(name)) {
    throw new Error(`"${name}" contains characters that are not allowed in a package name.`);
  }
  const grammar = language === "typescript" ? NPM_NAME : language === "python" ? PYPI_NAME : NUGET_NAME;
  if (!grammar.test(name)) {
    throw new Error(`"${name}" is not a valid ${registryName(language)} package name.`);
  }
}

function validateVersion(version: string): void {
  if (!VERSION_RE.test(version)) {
    throw new Error(`"${version}" is not a valid version specifier.`);
  }
}

function registryName(language: InstallLanguage): string {
  return language === "typescript" ? "npm" : language === "python" ? "PyPI" : "NuGet";
}

async function detectLanguage(root: string, signal?: AbortSignal): Promise<InstallLanguage[] | undefined> {
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

async function defaultRegistryLookup(language: InstallLanguage, name: string, signal?: AbortSignal): Promise<RegistryInfo> {
  const url =
    language === "typescript"
      ? `https://registry.npmjs.org/${encodeURIComponent(name).replace("%40", "@")}`
      : language === "python"
        ? `https://pypi.org/pypi/${encodeURIComponent(name)}/json`
        : `https://api.nuget.org/v3-flatcontainer/${encodeURIComponent(name).toLowerCase()}/index.json`;
  let response: Response;
  try {
    response = await fetch(url, { signal, redirect: "error" });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new Error(`Could not reach the ${registryName(language)} registry to verify "${name}": ${(err as Error).message}`);
  }
  if (response.status === 404) return { exists: false };
  if (!response.ok) {
    throw new Error(`The ${registryName(language)} registry returned status ${response.status} for "${name}".`);
  }
  const body = (await response.json()) as Record<string, unknown>;
  if (language === "typescript") {
    const versions = Object.keys((body.versions as Record<string, unknown>) ?? {});
    return { exists: true, versions };
  }
  if (language === "python") {
    return { exists: true };
  }
  const versions = (body.versions as string[]) ?? [];
  return { exists: true, versions };
}

async function defaultRunInstall(
  language: InstallLanguage,
  args: string[],
  opts: { cwd: string; signal?: AbortSignal }
): Promise<InstallRunResult> {
  const command: string = language === "typescript" ? "npm" : "dotnet";
  try {
    if (language === "python") {
      const interpreter = findPythonInterpreter(opts.cwd);
      const result = await runCommand(interpreter.command, ["-m", "pip", "install", "--no-input", ...args], {
        cwd: opts.cwd,
        signal: opts.signal,
        maxBuffer: MAX_BUFFER,
        timeoutMs: INSTALL_TIMEOUT_MS,
      });
      const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim() || "(no output)";
      return { success: result.exitCode === 0, output };
    }
    const result = await runCommand(command, args, {
      cwd: opts.cwd,
      signal: opts.signal,
      maxBuffer: MAX_BUFFER,
      timeoutMs: INSTALL_TIMEOUT_MS,
    });
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim() || "(no output)";
    return { success: result.exitCode === 0, output };
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    if (err instanceof CommandNotFoundError) {
      return {
        success: false,
        output: `${err.message}${language === "python" ? `. Create a .venv in the project or set $${PYTHON_ENV_VAR}.` : ""}`,
      };
    }
    return { success: false, output: describeCommandError(err) };
  }
}

/**
 * Installs an official registry package. Two-phase safety: the name must pass
 * the ecosystem's registry grammar (rejecting local files, paths and URLs by
 * construction), then the package's existence is confirmed against the
 * official registry API before the package manager runs — always with array
 * args (no shell). npm installs use --ignore-scripts so package lifecycle
 * scripts never execute; native-compiling packages are reported with rebuild
 * instructions instead.
 */
export async function install(sb: Sandbox, opts: InstallOptions): Promise<InstallResult> {
  const deps: InstallDeps = {
    registryLookup: defaultRegistryLookup,
    runInstall: defaultRunInstall,
    fetchJson: async () => undefined,
    ...opts.deps,
  };
  opts.signal?.throwIfAborted();

  const name = opts.package;
  const detected = opts.language ? [opts.language] : await detectLanguage(sb.resolve("."), opts.signal);
  if (!detected || detected.length === 0) {
    return {
      success: false,
      output:
        "Could not detect the language (no package.json, .csproj/.fsproj or .py files). Pass language=\"typescript\" | \"python\" | \"dotnet\".",
    };
  }
  if (detected.length > 1) {
    return {
      success: false,
      output: `Multiple languages detected (${detected.join(", ")}). Pass language="typescript" | "python" | "dotnet" to pick one.`,
    };
  }
  const language = detected[0]!;
  validateName(language, name);
  if (opts.version) validateVersion(opts.version);

  const info = await deps.registryLookup(language, name, opts.signal);
  if (!info.exists) {
    return {
      success: false,
      output: `Package "${name}" is not registered on ${registryName(language)}. Only officially registered packages can be installed.`,
    };
  }
  if (opts.version && info.versions && info.versions.length > 0 && !info.versions.includes(opts.version)) {
    return {
      success: false,
      output: `Version ${opts.version} of "${name}" is not registered on ${registryName(language)}. Available versions include: ${info.versions.slice(-5).join(", ")}.`,
    };
  }

  if (language === "typescript") {
    const spec = opts.version ? `${name}@${opts.version}` : name;
    const args = ["install", spec, "--ignore-scripts"];
    if (opts.dev) args.push("--save-dev");
    const run = await deps.runInstall(language, args, { cwd: sb.resolve("."), signal: opts.signal });
    const note = !run.success && /node-gyp|prebuilt|gyp ERR|build error/i.test(run.output)
      ? "\n\nThis package needs native compilation, which install skips for safety (--ignore-scripts). Rebuild manually with: npm rebuild <package> --build-from-source"
      : run.success && /native|node-gyp/i.test(run.output)
        ? "\n\nNote: installed with --ignore-scripts. If this package needs native compilation, run: npm rebuild <package> --build-from-source"
        : "";
    return { success: run.success, language, output: run.output + note };
  }

  if (language === "python") {
    const spec = opts.version ? `${name}==${opts.version}` : name;
    const run = await deps.runInstall(language, [spec], { cwd: sb.resolve("."), signal: opts.signal });
    return { success: run.success, language, output: run.output };
  }

  // dotnet
  const target = opts.project ?? (await singleDotnetProject(sb, opts.signal));
  if (!target) {
    return {
      success: false,
      language,
      output: "No unique .NET project found in the root. Pass project=\"path/to/App.csproj\".",
    };
  }
  const args = ["add", "package", name, "--version", opts.version ?? "*", "--project", sb.relative(target)];
  if (opts.version) args.splice(3, 2, "--version", opts.version);
  const run = await deps.runInstall(language, args, { cwd: sb.resolve("."), signal: opts.signal });
  return { success: run.success, language, output: run.output };
}

async function singleDotnetProject(sb: Sandbox, signal?: AbortSignal): Promise<string | undefined> {
  signal?.throwIfAborted();
  const patterns = ["*.csproj", "*.fsproj", "*.vbproj"];
  const matches: string[] = [];
  for (const pattern of patterns) {
    matches.push(...(await fg(pattern, { cwd: sb.resolve("."), onlyFiles: true, dot: true })));
  }
  if (matches.length !== 1) return undefined;
  return path.join(sb.resolve("."), matches[0]!);
}

export function registerInstallTool(pi: ToolRegistry) {
  pi.registerTool({
    ...INSTALL_TOOL_DEFINITION,
    prepareArguments: withConciseValidationErrors(INSTALL_TOOL_DEFINITION.name, INSTALL_TOOL_DEFINITION.parameters),
    renderCall(args, theme) {
      let text = `${callName(theme, "install")} ${theme.fg("accent", args.package ?? "")}`;
      if (args.version) text += theme.fg("toolOutput", `@${args.version}`);
      if (args.language) text += theme.fg("toolOutput", ` [${args.language}]`);
      if (args.dev) text += theme.fg("toolOutput", " --dev");
      return oneLine(text);
    },
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const result = await install(sandboxFor(ctx.cwd), {
        package: params.package,
        version: params.version,
        language: params.language as InstallLanguage | undefined,
        dev: params.dev,
        project: params.project,
        signal,
      });

      const statusLine = result.success
        ? `✓ Installed ${params.package}`
        : `✗ Install failed`;

      return {
        content: [{ type: "text", text: `${statusLine}\n\n${result.output}` }],
        details: result,
      };
    },
  });
}
