import * as fs from "node:fs/promises";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { MKDIR_TOOL_DEFINITION } from "../tool_definitions/mkdir.ts";
import { resolveSandboxPath } from "../sandbox.ts";
import { oneLine, callName } from "../renderCall.ts";

export interface MakeDirOptions {
  signal?: AbortSignal;
}

/**
 * Creates `dirPath`, including any missing parent directories. `fs.mkdir`
 * doesn't accept a `signal` option (unlike `fs.readFile`/`writeFile`), so
 * the best we can do is fail fast if already aborted before starting — a
 * `mkdir -p` chain is a handful of syscalls, not a long-running scan, so
 * there's nothing meaningful to interrupt mid-flight.
 */
export async function makeDir(dirPath: string, opts: MakeDirOptions = {}): Promise<void> {
  opts.signal?.throwIfAborted();
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (err) {
    throw new Error(`Could not create directory "${dirPath}": ${(err as Error).message}`);
  }
}

export function registerMkdirTool(pi: ExtensionAPI) {
  pi.registerTool({
    ...MKDIR_TOOL_DEFINITION,
    renderCall(args, theme) {
      return oneLine(`${callName(theme, "mkdir")} ${theme.fg("accent", args.path ?? "")}`);
    },
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const dirPath = resolveSandboxPath(ctx.cwd, params.path, "edit");
      await makeDir(dirPath, { signal });

      return {
        content: [{ type: "text", text: `Created directory ${params.path}.` }],
        details: {},
      };
    },
  });
}
