import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { isLibraryPathSafe } from "../../sandbox.ts";
import { runCommand, CommandNotFoundError, describeCommandError } from "../../runCommand.ts";
import type { ApiEntry, LibExtraction, LibraryInfo } from "./types.ts";
import { displayPath, isFile } from "./paths.ts";

/** The stdlib-only helper script that does the actual work inside the project's interpreter. */
export const PY_HELPER = fileURLToPath(new URL("./py_libinfo.py", import.meta.url));

/** Environment variable that pins the interpreter (absolute path or a command on PATH). */
export const PYTHON_ENV_VAR = "PI_SMALL_MODELS_PYTHON";

const IS_WINDOWS = process.platform === "win32";
const VENV_DIRS = [".venv", "venv", "env"];

export interface PythonInterpreter {
  command: string;
  /** Why it was picked, for display ("project .venv", "$VIRTUAL_ENV", "PATH"). */
  reason: string;
}

function venvPython(venv: string): string | undefined {
  const candidates = IS_WINDOWS
    ? [path.join(venv, "Scripts", "python.exe")]
    : [path.join(venv, "bin", "python3"), path.join(venv, "bin", "python")];
  return candidates.find(isFile);
}

/**
 * Picks the interpreter whose packages the project uses. Not model-controllable:
 * `$PI_SMALL_MODELS_PYTHON`, then `$VIRTUAL_ENV`, then a `.venv`/`venv`/`env` directory in the
 * project root, then `python3` (`python` on Windows) from PATH.
 */
export function findPythonInterpreter(root: string, env: NodeJS.ProcessEnv = process.env): PythonInterpreter {
  const pinned = env[PYTHON_ENV_VAR]?.trim();
  if (pinned) return { command: pinned, reason: `$${PYTHON_ENV_VAR}` };
  if (env.VIRTUAL_ENV) {
    const p = venvPython(env.VIRTUAL_ENV);
    if (p) return { command: p, reason: "$VIRTUAL_ENV" };
  }
  for (const dir of VENV_DIRS) {
    const p = venvPython(path.join(root, dir));
    if (p) return { command: p, reason: `project ${dir}` };
  }
  return { command: IS_WINDOWS ? "python" : "python3", reason: "PATH" };
}

export interface PythonEnv {
  python: string;
  version: string;
  /** Real paths of the interpreter's sys.path directories — the only places the helper reads. */
  paths: string[];
  sitePackages: string[];
}

export interface PyHelperOptions {
  interpreter?: PythonInterpreter;
  signal?: AbortSignal;
  /** Tests only: extra directories prepended to the helper's sys.path. */
  extraSysPath?: string[];
}

/** Runs the helper with `python -I` (isolated: no PYTHON* env vars, no user site, no cwd on sys.path). */
export async function runPyHelper<T>(root: string, args: Record<string, unknown>, opts: PyHelperOptions = {}): Promise<T & { env: PythonEnv; interpreter: PythonInterpreter }> {
  const interpreter = opts.interpreter ?? findPythonInterpreter(root);
  const payload = JSON.stringify({ ...args, extraSysPath: opts.extraSysPath });
  let result;
  try {
    result = await runCommand(interpreter.command, ["-I", PY_HELPER, payload], { cwd: root, signal: opts.signal, maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    if (err instanceof CommandNotFoundError) {
      throw new Error(`No Python interpreter found (${interpreter.command}, from ${interpreter.reason}). Create a .venv in the project or set $${PYTHON_ENV_VAR}.`);
    }
    throw new Error(`Python helper failed: ${describeCommandError(err)}`);
  }
  let parsed: (T & { env: PythonEnv; error?: string }) | undefined;
  try {
    parsed = JSON.parse(result.stdout.trim().split("\n").pop() ?? "");
  } catch {
    parsed = undefined;
  }
  if (!parsed) {
    throw new Error(`Python helper failed (exit ${result.exitCode}): ${(result.stderr || result.stdout).trim().slice(-2000)}`);
  }
  if (parsed.error) throw new Error(parsed.error);
  return { ...parsed, interpreter };
}

interface RawEntry extends Omit<ApiEntry, "source"> {
  source?: string | null;
  line?: number;
  docs?: string;
}

interface LibResponse {
  info: {
    name: string;
    version?: string | null;
    location?: string | null;
    apiSource: string[];
    summary?: string | null;
    dependencies?: string[];
    modules?: string[] | null;
    module?: string | null;
    notes: string[];
  };
  entries: RawEntry[];
  rootContainer: string;
  /** The symbol after a leading module path was moved into `module`. */
  symbol?: string | null;
}

export interface PyLibOptions extends PyHelperOptions {
  module?: string;
  symbol?: string;
  includePrivate?: boolean;
}

/**
 * Locates an installed Python package for the project's interpreter and reads its API with
 * `ast` (never importing it). Returns the extraction plus the symbol to look up, which may have
 * lost a leading module path ("requests.adapters.HTTPAdapter" → module requests.adapters,
 * symbol HTTPAdapter).
 */
export async function extractPyLibrary(root: string, pkg: string, opts: PyLibOptions = {}): Promise<LibExtraction & { symbol?: string }> {
  const absRoot = path.resolve(root);
  const res = await runPyHelper<LibResponse>(
    absRoot,
    { cmd: "lib", package: pkg, module: opts.module, symbol: opts.symbol, includePrivate: opts.includePrivate ?? false },
    opts
  );

  // The helper only opens .py/.pyi files under sys.path; double-check everything it reports
  // against the same roots (plus the project, for editable installs) before showing paths.
  const libRoots = [absRoot, ...res.env.paths, ...(opts.extraSysPath ?? [])];
  const safe = (p: string | null | undefined) => !!p && isLibraryPathSafe(libRoots, p);
  const show = (p: string | null | undefined) => (p ? displayPath(absRoot, p) : undefined);

  const entries: ApiEntry[] = [];
  for (const e of res.entries) {
    if (e.source && !safe(e.source)) continue;
    entries.push({
      kind: e.kind,
      name: e.name,
      container: e.container,
      signature: e.signature,
      docs: e.docs ?? undefined,
      source: show(e.source),
      line: e.line ?? undefined,
      reexportedFrom: e.reexportedFrom ?? undefined,
    });
  }

  const i = res.info;
  const notes = [...i.notes, `Python ${res.env.version} at ${show(res.env.python)} (${res.interpreter.reason}).`];
  const info: LibraryInfo = {
    ecosystem: "python",
    name: i.name,
    version: i.version ?? undefined,
    location: show(i.location),
    apiSource: i.apiSource.filter(safe).map((p) => show(p)!),
    summary: i.summary ?? undefined,
    dependencies: i.dependencies?.length ? i.dependencies : undefined,
    modules: i.modules?.length ? i.modules : undefined,
    module: i.module ?? undefined,
    notes,
  };
  return { info, entries, rootContainer: res.rootContainer, symbol: res.symbol ?? undefined };
}

interface ListResponse {
  packages: { name: string; version: string; summary: string }[];
  detail?: {
    name: string;
    version: string;
    summary: string;
    requires: string[];
    optionalRequires: number;
    requiredBy: string[];
    topLevel: string[];
    requiresPython: string;
    urls: string[];
  };
}

export interface PyListResult {
  text: string;
  total: number;
  truncated: boolean;
}

const MAX_LIST_ROWS = 1000;

/** `pip list`-like listing of the interpreter's installed distributions, via importlib.metadata. */
export async function pyListPackages(root: string, filter: string | undefined, opts: PyHelperOptions = {}): Promise<PyListResult> {
  const absRoot = path.resolve(root);
  const res = await runPyHelper<ListResponse>(absRoot, { cmd: "list", filter: filter ?? "" }, opts);
  const lines: string[] = [`Python ${res.env.version} — ${displayPath(absRoot, res.env.python)} (${res.interpreter.reason})`];
  if (res.env.sitePackages.length) lines.push(`site-packages: ${res.env.sitePackages.map((p) => displayPath(absRoot, p)).join(", ")}`);
  lines.push("");

  const d = res.detail;
  if (d) {
    lines.push(`${d.name} ${d.version}`);
    if (d.summary) lines.push(`Summary: ${d.summary}`);
    if (d.requiresPython) lines.push(`Requires-Python: ${d.requiresPython}`);
    if (d.topLevel.length) lines.push(`Import as: ${d.topLevel.join(", ")}`);
    lines.push(`Requires: ${d.requires.length ? d.requires.join(", ") : "(none)"}${d.optionalRequires ? ` (+${d.optionalRequires} optional extras)` : ""}`);
    lines.push(`Required by: ${d.requiredBy.length ? d.requiredBy.join(", ") : "(none)"}`);
    for (const u of d.urls) lines.push(`URL: ${u}`);
    lines.push("", `Next: py_lib package="${d.topLevel[0] ?? d.name}" for its API.`);
    return { text: lines.join("\n"), total: 1, truncated: false };
  }

  const rows = res.packages;
  if (rows.length === 0) {
    lines.push(filter ? `No installed package matches "${filter}".` : "No packages installed.");
    return { text: lines.join("\n"), total: 0, truncated: false };
  }
  lines.push(`${filter ? `Packages matching "${filter}"` : "Installed packages"} (${rows.length}):`);
  const shown = rows.slice(0, MAX_LIST_ROWS);
  for (const r of shown) {
    const summary = r.summary ? `  — ${r.summary.length > 80 ? `${r.summary.slice(0, 79)}…` : r.summary}` : "";
    lines.push(`  ${r.name}==${r.version}${summary}`);
  }
  const truncated = rows.length > shown.length;
  if (truncated) lines.push(`[Showing ${shown.length} of ${rows.length}. Pass package= to filter.]`);
  return { text: lines.join("\n"), total: rows.length, truncated };
}
