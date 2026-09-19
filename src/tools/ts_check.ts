import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { TS_CHECK_TOOL_DEFINITION } from "../tool_definitions/ts_check.ts";
import { resolveSandboxPath } from "../sandbox.ts";
import { oneLine, callName } from "../renderCall.ts";

const execFile = promisify(execFileCb);

const MAX_BUFFER = 10 * 1024 * 1024; // 10MB — type errors can produce substantial output

export interface TsCheckOptions {
  /** Path (relative to `cwd`) to the tsconfig.json or project folder. Omit for the current directory. */
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
export async function tsCheck(cwd: string, opts: TsCheckOptions = {}): Promise<TsCheckResult> {
  const args = [];
  
  // Determine project path
  const projectPath = opts.project || opts.path;
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
  let exitCode = 0;
  
  try {
    const result = await execFile("npx", ["tsc", ...args], { 
      cwd, 
      signal: opts.signal, 
      maxBuffer: MAX_BUFFER,
      reject: false // Don't throw on non-zero exit — tsc returns non-zero when there are type errors
    });
    stdout = result.stdout;
    stderr = result.stderr;
    exitCode = result.status ?? 0;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).name === "AbortError") throw err;
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        success: false,
        output: "TypeScript (tsc) is not installed or not on PATH. Run 'npm install typescript' first.",
        exitCode: -1,
      };
    }
    return {
      success: false,
      output: `TypeScript type check failed: ${describeError(err)}`,
      exitCode: -1,
    };
  }

  const output = [stdout, stderr].filter(Boolean).join("\n").trim() || "No type errors found.";
  // Exit code 0 means success (no type errors), non-zero means type errors were found
  const success = exitCode === 0;

  return { success, output, exitCode };
}

function describeError(err: unknown): string {
  const e = err as NodeJS.ErrnoException & { stderr?: string };
  return e.stderr?.trim() || e.message || String(err);
}

export function registerTsCheckTool(pi: ExtensionAPI) {
  pi.registerTool({
    ...TS_CHECK_TOOL_DEFINITION,
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
      let relPath: string | undefined;
      let relProject: string | undefined;
      
      if (params.path) {
        const resolved = resolveSandboxPath(ctx.cwd, params.path, "read");
        const rel = path.relative(ctx.cwd, resolved);
        relPath = rel === "" ? undefined : rel;
      }
      
      if (params.project) {
        const resolved = resolveSandboxPath(ctx.cwd, params.project, "read");
        const rel = path.relative(ctx.cwd, resolved);
        relProject = rel === "" ? undefined : rel;
      }

      const result = await tsCheck(ctx.cwd, { 
        path: relPath,
        project: relProject,
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