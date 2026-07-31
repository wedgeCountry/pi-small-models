import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { REMOVE_TOOL_DEFINITION } from "../tool_definitions/remove.ts";
import { resolveSafePath } from "../pathSafety.ts";

export interface RemoveOptions {
  recursive?: boolean;
}

/** Deletes `targetPath`. Directories require `recursive: true`. */
export async function removePath(targetPath: string, opts: RemoveOptions = {}): Promise<void> {
  let stat;
  try {
    stat = await fs.lstat(targetPath);
  } catch (err) {
    throw new Error(`Could not remove "${targetPath}": ${(err as Error).message}`);
  }

  if (stat.isDirectory() && !opts.recursive) {
    throw new Error(`"${targetPath}" is a directory; set recursive to true to remove it`);
  }

  await fs.rm(targetPath, { recursive: !!opts.recursive });
}

export function registerRemoveTool(pi: ExtensionAPI) {
  pi.registerTool({
    ...REMOVE_TOOL_DEFINITION,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const targetPath = resolveSafePath(ctx.cwd, params.path);
      if (targetPath === path.resolve(ctx.cwd)) {
        throw new Error("Refusing to remove the project root");
      }

      await removePath(targetPath, { recursive: params.recursive });

      return {
        content: [{ type: "text", text: `Removed ${params.path}.` }],
        details: {},
      };
    },
  });
}
