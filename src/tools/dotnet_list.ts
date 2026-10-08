import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DOTNET_LIST_TOOL_DEFINITION } from "../tool_definitions/dotnet_list.ts";
import { resolveSandboxPath } from "../sandbox.ts";
import { oneLine, callName } from "../renderCall.ts";
import { withConciseValidationErrors } from "../toolValidation.ts";
import { runCommand, CommandNotFoundError, describeCommandError } from "../runCommand.ts";

const MAX_BUFFER = 10 * 1024 * 1024; // 10MB — package lists can be substantial for large solutions

export interface DotnetListOptions {
  /** Path (relative to `cwd`) to the project or solution to list packages for. Omit for the current directory. */
  path?: string;
  /** Show available updates for packages. */
  outdated?: boolean;
  /** Include transitive dependencies. */
  includeTransitive?: boolean;
  /** Include prerelease versions when checking for updates. */
  includePrerelease?: boolean;
  /** Show deprecated packages. */
  deprecated?: boolean;
  /** Show packages with known vulnerabilities. */
  vulnerable?: boolean;
  /** Skip automatic restore before listing. */
  noRestore?: boolean;
  signal?: AbortSignal;
}

export interface DotnetListResult {
  success: boolean;
  output: string;
  /** Exit code from dotnet (0 = success, non-zero = failure). */
  exitCode: number;
}

/**
 * Runs `dotnet package list` on a project or solution.
 */
export async function dotnetList(cwd: string, opts: DotnetListOptions = {}): Promise<DotnetListResult> {
  // Use "noun first" form (dotnet package list) for .NET 10+, but fall back to "verb first" (dotnet list package) for .NET 6-9
  // We'll use the newer form and let dotnet handle compatibility
  const args = ["package", "list"];
  
  if (opts.path) {
    args.push(opts.path);
  }
  
  if (opts.outdated) {
    args.push("--outdated");
  }
  
  if (opts.includeTransitive) {
    args.push("--include-transitive");
  }
  
  if (opts.includePrerelease) {
    args.push("--include-prerelease");
  }
  
  if (opts.deprecated) {
    args.push("--deprecated");
  }
  
  if (opts.vulnerable) {
    args.push("--vulnerable");
  }
  
  if (opts.noRestore) {
    args.push("--no-restore");
  }

  let stdout: string;
  let stderr: string;
  let exitCode: number;

  try {
    ({ stdout, stderr, exitCode } = await runCommand("dotnet", args, {
      cwd,
      signal: opts.signal,
      maxBuffer: MAX_BUFFER,
    }));
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    if (err instanceof CommandNotFoundError) {
      return { success: false, output: err.message, exitCode: -1 };
    }
    return {
      success: false,
      output: `dotnet package list failed: ${describeCommandError(err)}`,
      exitCode: -1,
    };
  }

  const output = [stdout, stderr].filter(Boolean).join("\n").trim() || "(no packages found)";
  const success = exitCode === 0;

  return { success, output, exitCode };
}

export function registerDotnetListTool(pi: ExtensionAPI) {
  pi.registerTool({
    ...DOTNET_LIST_TOOL_DEFINITION,
    prepareArguments: withConciseValidationErrors(DOTNET_LIST_TOOL_DEFINITION.name, DOTNET_LIST_TOOL_DEFINITION.parameters),
    renderCall(args, theme) {
      let text = callName(theme, "dotnet_list");
      if (args.path) {
        text += theme.fg("toolOutput", ` ${args.path}`);
      }
      if (args.outdated) {
        text += theme.fg("toolOutput", " --outdated");
      }
      if (args.includeTransitive) {
        text += theme.fg("toolOutput", " --include-transitive");
      }
      if (args.includePrerelease) {
        text += theme.fg("toolOutput", " --include-prerelease");
      }
      if (args.deprecated) {
        text += theme.fg("toolOutput", " --deprecated");
      }
      if (args.vulnerable) {
        text += theme.fg("toolOutput", " --vulnerable");
      }
      if (args.noRestore) {
        text += theme.fg("toolOutput", " --no-restore");
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

      const result = await dotnetList(ctx.cwd, { 
        path: relPath, 
        outdated: params.outdated,
        includeTransitive: params.includeTransitive,
        includePrerelease: params.includePrerelease,
        deprecated: params.deprecated,
        vulnerable: params.vulnerable,
        noRestore: params.noRestore,
        signal 
      });

      const statusLine = result.success 
        ? "✓ Package list retrieved" 
        : `✗ Package list failed (exit code ${result.exitCode})`;

      return {
        content: [{ type: "text", text: `${statusLine}\n\n${result.output}` }],
        details: result,
      };
    },
  });
}