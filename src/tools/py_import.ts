import * as path from "node:path";
import fg from "fast-glob";
import { PY_IMPORT_TOOL_DEFINITION } from "../tool_definitions/py_import.ts";
import type { ToolRegistry } from "../sandbox/permissionGate.ts";
import { sandboxFor, type Sandbox } from "../sandbox/sandbox.ts";
import { oneLine, callName } from "../backend/renderCall.ts";
import { withConciseValidationErrors } from "../backend/toolValidation.ts";
import { runCommand, CommandNotFoundError, describeCommandError } from "../commands/runCommand.ts";
import { DEFAULT_IGNORE_GLOBS } from "../commands/ignore.ts";
import { findPythonInterpreter, PYTHON_ENV_VAR } from "./libInfo/pythonLib.ts";

const MAX_BUFFER = 10 * 1024 * 1024;

// Import one file by path, with its own directory first on sys.path so
// same-directory sibling imports resolve. A unique dotted module name keeps
// files with the same basename from clashing in sys.modules.
const IMPORT_SNIPPET = [
  "import sys, importlib.util",
  "sys.path.insert(0, sys.argv[1])",
  "spec = importlib.util.spec_from_file_location(sys.argv[2], sys.argv[3])",
  "mod = importlib.util.module_from_spec(spec)",
  "sys.modules[spec.name] = mod",
  "spec.loader.exec_module(mod)",
].join("; ");

export interface PyImportOptions {
  /** Path (resolved through the sandbox) to check. Omit for the current directory. */
  path?: string;
  signal?: AbortSignal;
}

export interface PyImportResult {
  success: boolean;
  /** Number of .py files found and imported. */
  checked: number;
  /** Project-relative paths of files that failed to import, with their error messages. */
  failures: { file: string; error: string }[];
  output: string;
}

async function listPythonFiles(root: string, signal?: AbortSignal): Promise<string[]> {
  signal?.throwIfAborted();
  const stream = fg.stream("**/*.py", {
    cwd: root,
    ignore: DEFAULT_IGNORE_GLOBS,
    onlyFiles: true,
    dot: true,
    followSymbolicLinks: false,
  });
  const files: string[] = [];
  for await (const entry of stream) {
    files.push(String(entry));
  }
  return files.sort();
}

/**
 * Imports every Python file under `path` with the project's Python interpreter
 * (same discovery as py_lib). A file that fails to compile or whose top-level
 * imports don't resolve makes the whole check fail with `success: false`.
 */
export async function pyImport(sb: Sandbox, opts: PyImportOptions = {}): Promise<PyImportResult> {
  const root = sb.resolve(opts.path ?? ".");
  opts.signal?.throwIfAborted();

  const interpreter = findPythonInterpreter(sb.root);
  const files = await listPythonFiles(root, opts.signal);
  const failures: { file: string; error: string }[] = [];

  for (const [index, rel] of files.entries()) {
    const abs = path.join(root, rel);
    const relToProject = path.relative(sb.root, abs) || rel;
    const moduleName = `_py_import_check_${index}`;
    let result;
    try {
      result = await runCommand(
        interpreter.command,
        ["-c", IMPORT_SNIPPET, path.dirname(abs), moduleName, abs],
        { cwd: root, signal: opts.signal, maxBuffer: MAX_BUFFER }
      );
    } catch (err) {
      if ((err as Error).name === "AbortError") throw err;
      if (err instanceof CommandNotFoundError) {
        return {
          success: false,
          checked: 0,
          failures: [],
          output: `No Python interpreter found (${interpreter.command}, from ${interpreter.reason}). Create a .venv in the project or set $${PYTHON_ENV_VAR}.`,
        };
      }
      return {
        success: false,
        checked: 0,
        failures: [],
        output: `Python import check failed: ${describeCommandError(err)}`,
      };
    }
    if (result.exitCode !== 0) {
      const error = (result.stderr || result.stdout).trim() || `exit code ${result.exitCode}`;
      failures.push({ file: relToProject, error });
    }
  }

  const success = failures.length === 0;
  const output = success
    ? `All ${files.length} Python file(s) imported successfully.`
    : `${failures.length} of ${files.length} Python file(s) failed to import:\n` +
      failures.map((f) => `${f.file}: ${f.error}`).join("\n");
  return { success, checked: files.length, failures, output };
}

export function registerPyImportTool(pi: ToolRegistry) {
  pi.registerTool({
    ...PY_IMPORT_TOOL_DEFINITION,
    prepareArguments: withConciseValidationErrors(PY_IMPORT_TOOL_DEFINITION.name, PY_IMPORT_TOOL_DEFINITION.parameters),
    renderCall(args, theme) {
      let text = callName(theme, "py_import");
      if (args.path) {
        text += theme.fg("toolOutput", ` ${args.path}`);
      }
      return oneLine(text);
    },
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const result = await pyImport(sandboxFor(ctx.cwd), { path: params.path, signal });

      const statusLine = result.success
        ? "✓ All Python files import"
        : `✗ Python import failures (${result.failures.length})`;

      return {
        content: [{ type: "text", text: `${statusLine}\n\n${result.output}` }],
        details: result,
      };
    },
  });
}
