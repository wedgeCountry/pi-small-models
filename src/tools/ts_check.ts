import { TS_CHECK_TOOL_DEFINITION } from "../tool_definitions/ts_check.ts";
import type { ToolRegistry } from "../sandbox/permissionGate.ts";
import { sandboxFor, type Sandbox } from "../sandbox/sandbox.ts";
import { oneLine, callName } from "../renderCall.ts";
import { withConciseValidationErrors } from "../toolValidation.ts";
import { runCommand, CommandNotFoundError, describeCommandError } from "../runCommand.ts";

const MAX_BUFFER = 10 * 1024 * 1024; // 10MB — type errors can produce substantial output

export interface TsCheckOptions {
  /** Path (resolved through the sandbox) to the tsconfig.json or project folder. Omit for the current directory. */
  path?: string;
  /** Same as --project flag: compile the project given the path to its configuration file or folder. */
  project?: string;
  /** Do not emit outputs. Defaults to true. */
  noEmit?: boolean;
  /** Enable color and formatting in output. Defaults to true. */
  pretty?: boolean;
  signal?: AbortSignal;
}

export interface TsCheckResult {
  success: boolean;
  output: string;
  /** Exit code from tsc (0 = no type errors, non-zero = type errors found). */
  exitCode: number;
}

/**
 * Runs `tsc --noEmit` to type-check TypeScript code without emitting files.
 */
export async function tsCheck(sb: Sandbox, opts: TsCheckOptions = {}): Promise<TsCheckResult> {
  const args = [];
  
  // Determine project path
  const target = opts.project || opts.path;
  const projectPath = target ? sb.relative(target) : "";
  if (projectPath) {
    args.push("--project", projectPath);
  }
  
  // noEmit defaults to true for this tool
  const noEmit = opts.noEmit ?? true;
  if (noEmit) {
    args.push("--noEmit");
  }
  
  // pretty defaults to true
  const pretty = opts.pretty ?? true;
  if (pretty) {
    args.push("--pretty");
  }

  let stdout: string;
  let stderr: string;
  let exitCode: number;

  try {
    // tsc exits non-zero when there are type errors; runCommand still returns its output then.
    ({ stdout, stderr, exitCode } = await runCommand("npx", ["tsc", ...args], {
      cwd: sb.root,
      signal: opts.signal,
      maxBuffer: MAX_BUFFER,
    }));
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    if (err instanceof CommandNotFoundError) {
      return {
        success: false,
        output: "TypeScript (tsc) is not installed or not on PATH. Run 'npm install typescript' first.",
        exitCode: -1,
      };
    }
    return {
      success: false,
      output: `TypeScript type check failed: ${describeCommandError(err)}`,
      exitCode: -1,
    };
  }

  const output = [stdout, stderr].filter(Boolean).join("\n").trim() || "No type errors found.";
  // Exit code 0 means success (no type errors), non-zero means type errors were found
  const success = exitCode === 0;

  return { success, output, exitCode };
}

export function registerTsCheckTool(pi: ToolRegistry) {
  pi.registerTool({
    ...TS_CHECK_TOOL_DEFINITION,
    prepareArguments: withConciseValidationErrors(TS_CHECK_TOOL_DEFINITION.name, TS_CHECK_TOOL_DEFINITION.parameters),
    renderCall(args, theme) {
      let text = callName(theme, "ts_check");
      if (args.path) {
        text += theme.fg("toolOutput", ` ${args.path}`);
      }
      if (args.project) {
        text += theme.fg("toolOutput", ` --project ${args.project}`);
      }
      if (args.noEmit === false) {
        text += theme.fg("toolOutput", " --emit");
      }
      if (args.pretty === false) {
        text += theme.fg("toolOutput", " --no-pretty");
      }
      return oneLine(text);
    },
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const result = await tsCheck(sandboxFor(ctx.cwd), {
        path: params.path,
        project: params.project,
        noEmit: params.noEmit,
        pretty: params.pretty,
        signal 
      });

      const statusLine = result.success 
        ? "✓ No type errors found" 
        : `✗ Type errors found (exit code ${result.exitCode})`;

      return {
        content: [{ type: "text", text: `${statusLine}\n\n${result.output}` }],
        details: result,
      };
    },
  });
}