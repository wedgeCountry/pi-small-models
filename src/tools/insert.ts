import * as fs from "node:fs/promises";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { INSERT_TOOL_DEFINITION } from "../tool_definitions/insert.ts";
import { resolveSafePath } from "../pathSafety.ts";

/** Inserts `text` into `filePath` after the given 1-indexed `line` (0 inserts before the first line). */
export async function insertText(filePath: string, line: number, text: string): Promise<void> {
  if (!Number.isInteger(line) || line < 0) {
    throw new Error(`line must be a non-negative integer, got ${line}`);
  }

  let content: string;
  try {
    content = await fs.readFile(filePath, "utf8");
  } catch (err) {
    throw new Error(`Could not read file "${filePath}": ${(err as Error).message}`);
  }

  const lines = content.split("\n");
  if (line > lines.length) {
    throw new Error(`line ${line} is past the end of "${filePath}" (${lines.length} line(s))`);
  }

  lines.splice(line, 0, ...text.split("\n"));
  await fs.writeFile(filePath, lines.join("\n"), "utf8");
}

export function registerInsertTool(pi: ExtensionAPI) {
  pi.registerTool({
    ...INSERT_TOOL_DEFINITION,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const filePath = resolveSafePath(ctx.cwd, params.path);
      await insertText(filePath, params.line, params.text);

      return {
        content: [{ type: "text", text: `Inserted text into ${params.path} after line ${params.line}.` }],
        details: {},
      };
    },
  });
}
