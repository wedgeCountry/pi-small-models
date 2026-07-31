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

  // Detect and preserve the file's line ending so the inserted text doesn't end up
  // with a different terminator than the rest of the file (e.g. bare "\n" spliced
  // into a CRLF file, leaving mixed line endings behind).
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r\n|\n/);
  if (line > lines.length) {
    throw new Error(`line ${line} is past the end of "${filePath}" (${lines.length} line(s))`);
  }

  lines.splice(line, 0, ...text.split(/\r\n|\n/));
  await fs.writeFile(filePath, lines.join(eol), "utf8");
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
