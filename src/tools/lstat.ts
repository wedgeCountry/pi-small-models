import * as fs from "node:fs/promises";
import { LSTAT_TOOL_DEFINITION } from "../tool_definitions/lstat.ts";
import type { ToolRegistry } from "../sandbox/permissionGate.ts";
import { sandboxFor, type Sandbox } from "../sandbox/sandbox.ts";
import { oneLine, callName } from "../backend/renderCall.ts";
import { withConciseValidationErrors } from "../backend/toolValidation.ts";
import { toolError } from "../backend/formatError.ts";
import { escapeTripleBackticks } from "../backend/escapeBackticks.ts";

export interface LstatResult {
  isFile: boolean;
  isDirectory: boolean;
  isSymbolicLink: boolean;
  size: number;
  mtime: string;
}

/** Returns filesystem metadata for `target` (resolved through `sb`) without following symlinks. */
export async function lstatPath(sb: Sandbox, target: string): Promise<LstatResult> {
  const targetPath = sb.resolve(target);
  let stat;
  try {
    stat = await fs.lstat(targetPath);
  } catch (err) {
    throw toolError("lstat", `Could not stat "${targetPath}": ${(err as Error).message}`, { path: target });
  }

  return {
    isFile: stat.isFile(),
    isDirectory: stat.isDirectory(),
    isSymbolicLink: stat.isSymbolicLink(),
    size: stat.size,
    mtime: stat.mtime.toISOString(),
  };
}

export function registerLstatTool(pi: ToolRegistry) {
  pi.registerTool({
    ...LSTAT_TOOL_DEFINITION,
    prepareArguments: withConciseValidationErrors(LSTAT_TOOL_DEFINITION.name, LSTAT_TOOL_DEFINITION.parameters),
    renderCall(args, theme) {
      return oneLine(`${callName(theme, "lstat")} ${theme.fg("accent", args.path ?? "")}`);
    },
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const result = await lstatPath(sandboxFor(ctx.cwd), params.path);

      const type = result.isSymbolicLink ? "symlink" : result.isDirectory ? "directory" : result.isFile ? "file" : "other";
      const text = `${params.path}: ${type}, ${result.size} bytes, modified ${result.mtime}`;

      return {
        content: [{ type: "text", text: escapeTripleBackticks(text) }],
        details: result,
      };
    },
  });
}
