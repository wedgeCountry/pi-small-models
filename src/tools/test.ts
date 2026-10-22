import * as fs from "node:fs/promises";
import * as path from "node:path";
import fg from "fast-glob";
import { TEST_TOOL_DEFINITION } from "../tool_definitions/test.ts";
import type { ToolRegistry } from "../sandbox/permissionGate.ts";
import { sandboxFor, type Sandbox } from "../sandbox/sandbox.ts";
import { oneLine, callName } from "../backend/renderCall.ts";
import { withConciseValidationErrors } from "../backend/toolValidation.ts";
import { runCommand, CommandNotFoundError, describeCommandError } from "../commands/runCommand.ts";
import { findPythonInterpreter } from "./libInfo/pythonLib.ts";

const MAX_BUFFER = 10 * 1024 * 1024;

export interface TestOptions {
  /** Path (resolved through the sandbox) to test. Omit for the current directory. */
  path?: string;
  /** Build configuration forwarded to dotnet test: Debug or Release. */
  configuration?: "Debug" | "Release";
  signal?: AbortSignal;
  /** Tests only: inject mock step implementations. Receives (sb, opts) and returns a step result. */
  deps?: Partial<TestDeps>;
}

/** The per-language test runners `testProject` orchestrates (injectable for tests). */
export interface TestDeps {
  dotnetTest: (sb: Sandbox, opts: TestOptions) => Promise<CommandRun>;
  npmTest: (sb: Sandbox, opts: TestOptions) => Promise<CommandRun>;
  pytest: (sb: Sandbox, opts: TestOptions) => Promise<CommandRun>;
}

export interface TestStepResult {
  step: "dotnet_test" | "npm_test" | "pytest";
  skipped: boolean;
  success: boolean;
  output: string;
}

export interface TestResult {
  success: boolean;
  steps: TestStepResult[];
  output: string;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isFile();
  } catch {
    return false;
  }
}

async function dirExists(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

async function hasDotnetProject(root: string, signal?: AbortSignal): Promise<boolean> {
  const patterns = ["*.csproj", "*.fsproj", "*.vbproj", "*.sln", "*.slnx"];
  signal?.throwIfAborted();
  for (const pattern of patterns) {
    const matches = await fg(pattern, { cwd: root, onlyFiles: true, dot: true });
    if (matches.length > 0) return true;
  }
  return false;
}

async function hasNpmTestScript(root: string): Promise<boolean> {
  const pkgPath = path.join(root, "package.json");
  if (!(await fileExists(pkgPath))) return false;
  try {
    const pkg = JSON.parse(await fs.readFile(pkgPath, "utf8"));
    return typeof pkg?.scripts?.test === "string";
  } catch {
    return false;
  }
}

async function hasPythonTests(root: string, signal?: AbortSignal): Promise<boolean> {
  signal?.throwIfAborted();
  const matches = await fg("**/test_*.py", {
    cwd: root,
    onlyFiles: true,
    dot: true,
    ignore: ["**/node_modules/**", "**/.venv/**", "**/__pycache__/**", "**/dist/**", "**/build/**"],
  });
  if (matches.length > 0) return true;
  return (await fg("**/*_test.py", {
    cwd: root,
    onlyFiles: true,
    dot: true,
    ignore: ["**/node_modules/**", "**/.venv/**", "**/__pycache__/**", "**/dist/**", "**/build/**"],
  })).length > 0;
}

export interface CommandRun {
  success: boolean;
  output: string;
  notInstalled: boolean;
}

async function runStep(command: string, args: string[], cwd: string, opts: { signal?: AbortSignal; label: string }): Promise<CommandRun> {
  let result;
  try {
    result = await runCommand(command, args, { cwd, signal: opts.signal, maxBuffer: MAX_BUFFER, timeoutMs: 600_000 });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    if (err instanceof CommandNotFoundError) {
      return { success: false, output: `${opts.label} (${command}) is not installed or not on PATH.`, notInstalled: true };
    }
    return { success: false, output: `${opts.label} failed: ${describeCommandError(err)}`, notInstalled: false };
  }
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim() || "(no output)";
  return { success: result.exitCode === 0, output, notInstalled: false };
}

/**
 * Runs the project's tests for every language present under `path` (default:
 * the session's cwd, resolved through the sandbox): `dotnet test`, `npm test`
 * and `pytest`. Absent languages are skipped; any failing step fails the whole
 * tool.
 */
export async function testProject(sb: Sandbox, opts: TestOptions = {}): Promise<TestResult> {
  const root = sb.resolve(opts.path ?? ".");
  opts.signal?.throwIfAborted();

  if (!(await dirExists(root))) {
    return { success: false, steps: [], output: `Path does not exist: ${sb.relative(opts.path ?? ".")}` };
  }

  const realDeps: TestDeps = {
    dotnetTest: (sb2, o) => {
      const args = ["test"];
      const scope = o.path ? sb2.relative(o.path) : "";
      if (scope) args.push(scope);
      if (o.configuration) args.push("--configuration", o.configuration);
      return runStep("dotnet", args, sb2.root, { signal: o.signal, label: "dotnet test" });
    },
    npmTest: (sb2, o) => runStep("npm", ["test"], sb2.resolve(o.path ?? "."), { signal: o.signal, label: "npm test" }),
    pytest: (sb2, o) => {
      const interpreter = findPythonInterpreter(sb2.root);
      return runStep(interpreter.command, ["-m", "pytest", sb2.relative(sb2.resolve(o.path ?? "."))], sb2.root, { signal: o.signal, label: `pytest (${interpreter.reason})` });
    },
  };
  const deps: TestDeps = { ...realDeps, ...opts.deps };

  const steps: TestStepResult[] = [];

  if (await hasDotnetProject(root, opts.signal)) {
    const run = await deps.dotnetTest(sb, opts);
    steps.push({ step: "dotnet_test", skipped: false, success: run.success, output: run.output });
  } else {
    steps.push({ step: "dotnet_test", skipped: true, success: true, output: "No .NET project or solution found — skipped." });
  }

  if (await hasNpmTestScript(root)) {
    const run = await deps.npmTest(sb, opts);
    steps.push({ step: "npm_test", skipped: false, success: run.success, output: run.output });
  } else {
    steps.push({ step: "npm_test", skipped: true, success: true, output: "No package.json with a test script found — skipped." });
  }

  if (await hasPythonTests(root, opts.signal)) {
    const run = await deps.pytest(sb, opts);
    steps.push({ step: "pytest", skipped: false, success: run.success, output: run.output });
  } else {
    steps.push({ step: "pytest", skipped: true, success: true, output: "No Python test files found — skipped." });
  }

  const success = steps.every((s) => s.success);
  const output = steps
    .map((s) => {
      const header = s.skipped ? `[${s.step}] skipped` : s.success ? `[${s.step}] ✓` : `[${s.step}] ✗`;
      return s.skipped ? `${header} — ${s.output}` : `${header}\n${s.output}`;
    })
    .join("\n\n");
  return { success, steps, output };
}

export function registerTestTool(pi: ToolRegistry) {
  pi.registerTool({
    ...TEST_TOOL_DEFINITION,
    prepareArguments: withConciseValidationErrors(TEST_TOOL_DEFINITION.name, TEST_TOOL_DEFINITION.parameters),
    renderCall(args, theme) {
      let text = callName(theme, "test");
      if (args.path) {
        text += theme.fg("toolOutput", ` ${args.path}`);
      }
      if (args.configuration) {
        text += theme.fg("toolOutput", ` --configuration ${args.configuration}`);
      }
      return oneLine(text);
    },
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const result = await testProject(sandboxFor(ctx.cwd), {
        path: params.path,
        configuration: params.configuration as "Debug" | "Release" | undefined,
        signal,
      });

      const statusLine = result.success
        ? "✓ All tests passed (all steps passed or skipped)"
        : "✗ Tests failed";

      return {
        content: [{ type: "text", text: `${statusLine}\n\n${result.output}` }],
        details: result,
      };
    },
  });
}
