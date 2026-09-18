import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DOTNET_BUILD_TOOL_DEFINITION } from "../tool_definitions/dotnet_build.ts";
import { resolveSandboxPath } from "../sandbox.ts";
import { oneLine, callName } from "../renderCall.ts";

const execFile = promisify(execFileCb);

const MAX_BUFFER = 10 * 1024 * 1024; // 10MB — builds can produce substantial output

export interface DotnetBuildOptions {
  /** Path (relative to `cwd`) to the project or solution to build. Omit for the current directory. */
  path?: string;
  /** Build configuration: Debug or Release. */
  configuration?: "Debug" | "Release";
  signal?: AbortSignal;
}

export interface DotnetBuildResult {
  success: boolean;
  output: string;
  /** Exit code from dotnet (0 = success, non-zero = failure). */
  exitCode: number;
}

/**
 * Runs `dotnet build` on a project or solution.
 */
export async function dotnetBuild(cwd: string, opts: DotnetBuildOptions = {}): Promise<DotnetBuildResult> {
  const args = ["build"];
  
  if (opts.path) {
    args.push(opts.path);
  }
  
  if (opts.configuration) {
    args.push("--configuration", opts.configuration);
  }

  let stdout: string;
  let stderr: string;
  let exitCode = 0;
  
  try {
    const result = await execFile("dotnet", args, { 
      cwd, 
      signal: opts.signal, 
      maxBuffer: MAX_BUFFER,
      reject: false // Don't throw on non-zero exit — we want to report build failures
    });
    stdout = result.stdout;
    stderr = result.stderr;
    exitCode = result.status ?? 0;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).name === "AbortError") throw err;
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        success: false,
        output: "dotnet is not installed or not on PATH",
        exitCode: -1,
      };
    }
    return {
      success: false,
      output: `dotnet build failed: ${describeError(err)}`,
      exitCode: -1,
    };
  }

  const output = [stdout, stderr].filter(Boolean).join("\n").trim() || "(no output)";
  const success = exitCode === 0;

  return { success, output, exitCode };
}

function describeError(err: unknown): string {
  const e = err as NodeJS.ErrnoException & { stderr?: string };
  return e.stderr?.trim() || e.message || String(err);
}

export function registerDotnetBuildTool(pi: ExtensionAPI) {
  pi.registerTool({
    ...DOTNET_BUILD_TOOL_DEFINITION,
    renderCall(args, theme) {
      let text = callName(theme, "dotnet_build");
      if (args.path) {
        text += theme.fg("toolOutput", ` ${args.path}`);
      }
      if (args.configuration) {
        text += theme.fg("toolOutput", ` --configuration ${args.configuration}`);
      }
      return oneLine(text);
    },
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      let relPath: string | undefined;
      if (params.path) {
        const resolved = resolveSandboxPath(ctx.cwd, params.path, "read");
        const rel = path.relative(ctx.cwd, resolved);
        relPath = rel === "" ? undefined : rel;
      }

      const result = await dotnetBuild(ctx.cwd, { 
        path: relPath, 
        configuration: params.configuration as "Debug" | "Release" | undefined,
        signal 
      });

      const statusLine = result.success 
        ? "✓ Build succeeded" 
        : `✗ Build failed (exit code ${result.exitCode})`;

      return {
        content: [{ type: "text", text: `${statusLine}\n\n${result.output}` }],
        details: result,
      };
    },
  });
}