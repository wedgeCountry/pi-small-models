import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { NPM_LIST_TOOL_DEFINITION } from "../tool_definitions/npm_list.ts";
import { resolveSandboxPath } from "../sandbox.ts";
import { oneLine, callName } from "../renderCall.ts";

const execFileAsync = promisify(execFile);

export interface NpmListOptions {
  depth?: number;
  package?: string;
  long?: boolean;
  signal?: AbortSignal;
}

export interface NpmListResult {
  output: string;
  truncated: boolean;
}

/**
 * Runs `npm list` in the given directory and returns the output.
 * Uses --json=false to get human-readable output and respects the depth option.
 */
export async function npmList(base: string, opts: NpmListOptions = {}): Promise<NpmListResult> {
  const depth = opts.depth ?? 0;
  const pkg = opts.package;
  const long = opts.long ?? false;

  opts.signal?.throwIfAborted();

  const args = ["list", "--json=false", `--depth=${depth}`];
  if (pkg) args.push(pkg);
  if (long) args.push("--long");

  let stdout: string;
  let stderr: string;

  try {
    const result = await execFileAsync("npm", args, {
      cwd: base,
      encoding: "utf8",
      signal: opts.signal,
      reject: false, // Don't throw on non-zero exit — npm list returns non-zero for missing deps
    });
    stdout = result.stdout ?? "";
    stderr = result.stderr ?? "";
  } catch (err: any) {
    if ((err as NodeJS.ErrnoException).name === "AbortError") throw err;
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        output: "npm is not installed or not on PATH",
        truncated: false,
      };
    }
    return {
      output: `npm list failed: ${describeError(err)}`,
      truncated: false,
    };
  }

  const output = stdout.trim() || (stderr ? stderr.trim() : "No packages found.");
  const truncated = output.length > 50000; // Cap at ~50KB similar to read tool

  return {
    output: truncated ? output.slice(0, 50000) + "\n... (output truncated)" : output,
    truncated,
  };
}

function describeError(err: unknown): string {
  const e = err as NodeJS.ErrnoException & { stderr?: string };
  return e.stderr?.trim() || e.message || String(err);
}

export function registerNpmListTool(pi: ExtensionAPI) {
  pi.registerTool({
    ...NPM_LIST_TOOL_DEFINITION,
    renderCall(args, theme) {
      let text = `${callName(theme, "npm_list")}`;
      if (args.package) text += theme.fg("accent", ` ${args.package}`);
      if (args.depth !== undefined) text += theme.fg("toolOutput", ` (depth ${args.depth})`);
      if (args.long) text += theme.fg("toolOutput", " --long");
      return oneLine(text);
    },
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const base = resolveSandboxPath(ctx.cwd, ".", "read");
      const result = await npmList(base, {
        depth: params.depth,
        package: params.package,
        long: params.long,
        signal,
      });

      return {
        content: [{ type: "text", text: result.output }],
        details: { truncated: result.truncated },
      };
    },
  });
}