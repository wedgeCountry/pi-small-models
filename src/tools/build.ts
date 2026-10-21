import * as fs from "node:fs/promises";
import * as path from "node:path";
import fg from "fast-glob";
import { BUILD_TOOL_DEFINITION } from "../tool_definitions/build.ts";
import type { ToolRegistry } from "../sandbox/permissionGate.ts";
import { sandboxFor, type Sandbox } from "../sandbox/sandbox.ts";
import { oneLine, callName } from "../backend/renderCall.ts";
import { withConciseValidationErrors } from "../backend/toolValidation.ts";
import { dotnetBuild, type DotnetBuildResult } from "./dotnet_build.ts";
import { tsCheck, type TsCheckResult } from "./ts_check.ts";
import { pyImport, type PyImportResult } from "./py_import.ts";

export interface BuildOptions {
  /** Path (resolved through the sandbox) to build. Omit for the current directory. */
  path?: string;
  /** Build configuration forwarded to dotnet_build: Debug or Release. */
  configuration?: "Debug" | "Release";
  signal?: AbortSignal;
  /** Tests only: inject mock step implementations. Each receives the sandbox-resolved root. */
  deps?: Partial<BuildDeps>;
}

/** The per-language implementations `build` orchestrates (injectable for tests). */
export interface BuildDeps {
  dotnetBuild: typeof dotnetBuild;
  tsCheck: typeof tsCheck;
  pyImport: typeof pyImport;
}

export interface BuildStepResult {
  step: "dotnet_build" | "ts_check" | "py_import";
  skipped: boolean;
  success: boolean;
  output: string;
}

export interface BuildResult {
  success: boolean;
  steps: BuildStepResult[];
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

async function hasPythonFiles(root: string, signal?: AbortSignal): Promise<boolean> {
  signal?.throwIfAborted();
  const matches = await fg("**/*.py", {
    cwd: root,
    onlyFiles: true,
    dot: true,
    ignore: ["**/node_modules/**", "**/.venv/**", "**/__pycache__/**", "**/dist/**", "**/build/**"],
  });
  return matches.length > 0;
}

/**
 * Unified build check: runs dotnet_build, ts_check and py_import over `path`
 * (default: the session's cwd, resolved through the sandbox), skipping the
 * languages that are not present in the project. Fails when any run step fails.
 */
export async function build(sb: Sandbox, opts: BuildOptions = {}): Promise<BuildResult> {
  const root = sb.resolve(opts.path ?? ".");
  opts.signal?.throwIfAborted();

  if (!(await dirExists(root))) {
    return { success: false, steps: [], output: `Path does not exist: ${sb.relative(opts.path ?? ".")}` };
  }

  const steps: BuildStepResult[] = [];

  const deps: BuildDeps = { dotnetBuild, tsCheck, pyImport, ...opts.deps };

  if (await hasDotnetProject(root, opts.signal)) {
    const result: DotnetBuildResult = await deps.dotnetBuild(sb, { path: opts.path, configuration: opts.configuration, signal: opts.signal });
    steps.push({ step: "dotnet_build", skipped: false, success: result.success, output: result.output });
  } else {
    steps.push({ step: "dotnet_build", skipped: true, success: true, output: "No .NET project or solution found — skipped." });
  }

  const tsconfig = path.join(root, "tsconfig.json");
  if (await fileExists(tsconfig)) {
    const tsconfigRel = sb.relative(path.join(opts.path ?? ".", "tsconfig.json"));
    const result: TsCheckResult = await deps.tsCheck(sb, { path: tsconfigRel, signal: opts.signal });
    steps.push({ step: "ts_check", skipped: false, success: result.success, output: result.output });
  } else {
    steps.push({ step: "ts_check", skipped: true, success: true, output: "No tsconfig.json found — skipped." });
  }

  if (await hasPythonFiles(root, opts.signal)) {
    const result: PyImportResult = await deps.pyImport(sb, { path: opts.path, signal: opts.signal });
    steps.push({ step: "py_import", skipped: false, success: result.success, output: result.output });
  } else {
    steps.push({ step: "py_import", skipped: true, success: true, output: "No Python files found — skipped." });
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

export function registerBuildTool(pi: ToolRegistry) {
  pi.registerTool({
    ...BUILD_TOOL_DEFINITION,
    prepareArguments: withConciseValidationErrors(BUILD_TOOL_DEFINITION.name, BUILD_TOOL_DEFINITION.parameters),
    renderCall(args, theme) {
      let text = callName(theme, "build");
      if (args.path) {
        text += theme.fg("toolOutput", ` ${args.path}`);
      }
      if (args.configuration) {
        text += theme.fg("toolOutput", ` --configuration ${args.configuration}`);
      }
      return oneLine(text);
    },
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const result = await build(sandboxFor(ctx.cwd), {
        path: params.path,
        configuration: params.configuration as "Debug" | "Release" | undefined,
        signal,
      });

      const statusLine = result.success
        ? "✓ Build succeeded (all steps passed or skipped)"
        : "✗ Build failed";

      return {
        content: [{ type: "text", text: `${statusLine}\n\n${result.output}` }],
        details: result,
      };
    },
  });
}
