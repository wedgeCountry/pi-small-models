import * as fs from "node:fs/promises";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { LSTAT_TOOL_DEFINITION } from "../tool_definitions/lstat.ts";
import { resolveSafePath } from "../pathSafety.ts";

export interface LstatResult {
  isFile: boolean;
  isDirectory: boolean;
  isSymbolicLink: boolean;
  size: number;
  mtime: string;
}

/** Returns filesystem metadata for `targetPath` without following symlinks. */
export async function lstatPath(targetPath: string): Promise<LstatResult> {
  let stat;
  try {
    stat = await fs.lstat(targetPath);
  } catch (err) {
    throw new Error(`Could not stat "${targetPath}": ${(err as Error).message}`);
  }

  return {
    isFile: stat.isFile(),
    isDirectory: stat.isDirectory(),
    isSymbolicLink: stat.isSymbolicLink(),
    size: stat.size,
    mtime: stat.mtime.toISOString(),
  };
}

export function registerLstatTool(pi: ExtensionAPI) {
  pi.registerTool({
    ...LSTAT_TOOL_DEFINITION,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const targetPath = resolveSafePath(ctx.cwd, params.path);
      const result = await lstatPath(targetPath);

      const type = result.isSymbolicLink ? "symlink" : result.isDirectory ? "directory" : result.isFile ? "file" : "other";
      const text = `${params.path}: ${type}, ${result.size} bytes, modified ${result.mtime}`;

      return {
        content: [{ type: "text", text }],
        details: result,
      };
    },
  });
}
