import fg from "fast-glob";
import * as path from "node:path";
import { UNINSTALL_TOOL_DEFINITION } from "../tool_definitions/uninstall.ts";
import type { ToolRegistry } from "../sandbox/permissionGate.ts";
import { sandboxFor, type Sandbox } from "../sandbox/sandbox.ts";
import { oneLine, callName } from "../backend/renderCall.ts";
import { withConciseValidationErrors } from "../backend/toolValidation.ts";
import { runCommand, CommandNotFoundError, describeCommandError } from "../commands/runCommand.ts";
import { findPythonInterpreter, PYTHON_ENV_VAR } from "./libInfo/pythonLib.ts";
import { removeRequirement } from "./requirementsManifest.ts";
import type { InstallLanguage } from "./installShared.ts";
import { validateName, detectLanguage, singleDotnetProject } from "./installShared.ts";

const MAX_BUFFER = 10 * 1024 * 1024;
const UNINSTALL_TIMEOUT_MS = 10 * 60 * 1000;

export interface UninstallOptions {
  /** Installed package name (validated against the ecosystem grammar). */
  package: string;
  /** Pin the ecosystem. Omit to detect from the project. */
  language?: InstallLanguage;
  /** dotnet only: target project. Defaults to the single project in the root. */
  project?: string;
  signal?: AbortSignal;
  /** Tests only: inject command execution and manifest editing. */
  deps?: Partial<UninstallDeps>;
}

export interface UninstallDeps {
  runUninstall: (language: InstallLanguage, args: string[], opts: { cwd: string; signal?: AbortSignal }) => Promise<UninstallRunResult>;
  removeRequirement: typeof removeRequirement;
}

export interface UninstallRunResult {
  success: boolean;
  output: string;
}

export interface UninstallResult {
  success: boolean;
  language?: InstallLanguage;
  output: string;
}

/**
 * Removes an installed package: `npm uninstall` (updates package.json and the
 * lockfile), `pip uninstall` (plus removing the pin from requirements.txt when
 * present) or `dotnet remove package` (updates the .csproj). Names are
 * validated with the same grammar as install; commands run with array args
 * (no shell).
 */
export async function uninstall(sb: Sandbox, opts: UninstallOptions): Promise<UninstallResult> {
  const deps: UninstallDeps = {
    runUninstall: defaultRunUninstall,
    removeRequirement,
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

  if (language === "typescript") {
    const run = await deps.runUninstall(language, ["uninstall", name], { cwd: sb.resolve("."), signal: opts.signal });
    return { success: run.success, language, output: run.output };
  }

  if (language === "python") {
    const run = await deps.runUninstall(language, ["-m", "pip", "uninstall", "--yes", name], {
      cwd: sb.resolve("."),
      signal: opts.signal,
    });
    const manifestNote = await deps.removeRequirement(sb.resolve("."), name);
    const output = manifestNote ? `${run.output}\n${manifestNote}` : run.output;
    return { success: run.success, language, output };
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
  const run = await deps.runUninstall(language, ["remove", "package", name, "--project", sb.relative(target)], {
    cwd: sb.resolve("."),
    signal: opts.signal,
  });
  return { success: run.success, language, output: run.output };
}

async function defaultRunUninstall(
  language: InstallLanguage,
  args: string[],
  opts: { cwd: string; signal?: AbortSignal }
): Promise<UninstallRunResult> {
  const command = language === "typescript" ? "npm" : language === "python" ? undefined : "dotnet";
  try {
    if (language === "python") {
      const interpreter = findPythonInterpreter(opts.cwd);
      const result = await runCommand(interpreter.command, args, {
        cwd: opts.cwd,
        signal: opts.signal,
        maxBuffer: MAX_BUFFER,
        timeoutMs: UNINSTALL_TIMEOUT_MS,
      });
      const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim() || "(no output)";
      return { success: result.exitCode === 0, output };
    }
    const result = await runCommand(command as string, args, {
      cwd: opts.cwd,
      signal: opts.signal,
      maxBuffer: MAX_BUFFER,
      timeoutMs: UNINSTALL_TIMEOUT_MS,
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

export function registerUninstallTool(pi: ToolRegistry) {
  pi.registerTool({
    ...UNINSTALL_TOOL_DEFINITION,
    prepareArguments: withConciseValidationErrors(UNINSTALL_TOOL_DEFINITION.name, UNINSTALL_TOOL_DEFINITION.parameters),
    renderCall(args, theme) {
      let text = `${callName(theme, "uninstall")} ${theme.fg("accent", args.package ?? "")}`;
      if (args.language) text += theme.fg("toolOutput", ` [${args.language}]`);
      return oneLine(text);
    },
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const result = await uninstall(sandboxFor(ctx.cwd), {
        package: params.package,
        language: params.language as InstallLanguage | undefined,
        project: params.project,
        signal,
      });

      const statusLine = result.success
        ? `✓ Uninstalled ${params.package}`
        : `✗ Uninstall failed`;

      return {
        content: [{ type: "text", text: `${statusLine}\n\n${result.output}` }],
        details: result,
      };
    },
  });
}
