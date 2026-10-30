import * as fs from "node:fs/promises";
import { MKDIR_TOOL_DEFINITION } from "../tool_definitions/mkdir.ts";
import type { ToolRegistry } from "../sandbox/permissionGate.ts";
import { sandboxFor, type Sandbox } from "../sandbox/sandbox.ts";
import { oneLine, callName } from "../backend/renderCall.ts";
import { withConciseValidationErrors } from "../backend/toolValidation.ts";
import { toolOutput } from "../backend/toolOutput.ts";
import { toolError } from "../backend/formatError.ts";

export interface MakeDirOptions {
  signal?: AbortSignal;
}

/**
 * Creates `target` (resolved through `sb`), including any missing parent directories. `fs.mkdir`
 * doesn't accept a `signal` option (unlike `fs.readFile`/`writeFile`), so
 * the best we can do is fail fast if already aborted before starting — a
 * `mkdir -p` chain is a handful of syscalls, not a long-running scan, so
 * there's nothing meaningful to interrupt mid-flight.
 */
export async function makeDir(sb: Sandbox, target: string, opts: MakeDirOptions = {}): Promise<void> {
  opts.signal?.throwIfAborted();
  const dirPath = sb.resolve(target);

  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (err) {
    throw toolError("mkdir", `Could not create directory "${dirPath}": ${(err as Error).message}`, { path: target });
  }
}

export function registerMkdirTool(pi: ToolRegistry) {
  pi.registerTool({
    ...MKDIR_TOOL_DEFINITION,
    prepareArguments: withConciseValidationErrors(MKDIR_TOOL_DEFINITION.name, MKDIR_TOOL_DEFINITION.parameters),
    renderCall(args, theme) {
      return oneLine(`${callName(theme, "mkdir")} ${theme.fg("accent", args.path ?? "")}`);
    },
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      await makeDir(sandboxFor(ctx.cwd), params.path, { signal });

      return toolOutput({}, `Created directory ${params.path}.`);
    },
  });
}
