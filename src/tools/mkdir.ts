import * as fs from "node:fs/promises";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { MKDIR_TOOL_DEFINITION } from "../tool_definitions/mkdir.ts";
import { resolveSafePath } from "../pathSafety.ts";

/** Creates `dirPath`, including any missing parent directories. */
export async function makeDir(dirPath: string): Promise<void> {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (err) {
    throw new Error(`Could not create directory "${dirPath}": ${(err as Error).message}`);
  }
}

export function registerMkdirTool(pi: ExtensionAPI) {
  pi.registerTool({
    ...MKDIR_TOOL_DEFINITION,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const dirPath = resolveSafePath(ctx.cwd, params.path);
      await makeDir(dirPath);

      return {
        content: [{ type: "text", text: `Created directory ${params.path}.` }],
        details: {},
      };
    },
  });
}
