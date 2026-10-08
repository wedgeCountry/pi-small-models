import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { NPM_LIST_TOOL_DEFINITION } from "../tool_definitions/npm_list.ts";
import { resolveSandboxPath } from "../sandbox.ts";
import { oneLine, callName } from "../renderCall.ts";
import { withConciseValidationErrors } from "../toolValidation.ts";
import { runCommand, CommandNotFoundError, describeCommandError } from "../runCommand.ts";

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
  let exitCode: number;

  try {
    // `npm list` exits non-zero on missing/invalid/extraneous deps, but still prints the tree.
    ({ stdout, stderr, exitCode } = await runCommand("npm", args, { cwd: base, signal: opts.signal }));
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    if (err instanceof CommandNotFoundError) {
      return { output: err.message, truncated: false };
    }
    return { output: `npm list failed: ${describeCommandError(err)}`, truncated: false };
  }

  // On a non-zero exit, stderr names the problem (e.g. "missing: foo@^1.0.0") — keep it.
  const output =
    [stdout.trim(), exitCode !== 0 ? stderr.trim() : ""].filter(Boolean).join("\n\n") ||
    stderr.trim() ||
    "No packages found.";
  const truncated = output.length > 50000; // Cap at ~50KB similar to read tool

  return {
    output: truncated ? output.slice(0, 50000) + "\n... (output truncated)" : output,
    truncated,
  };
}

export function registerNpmListTool(pi: ExtensionAPI) {
  pi.registerTool({
    ...NPM_LIST_TOOL_DEFINITION,
    prepareArguments: withConciseValidationErrors(NPM_LIST_TOOL_DEFINITION.name, NPM_LIST_TOOL_DEFINITION.parameters),
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