import * as fs from "node:fs/promises";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { EDIT_TOOL_DEFINITION } from "../tool_definitions/edit.ts";
import { resolveSafePath } from "../pathSafety.ts";

/** Replaces the single, unique occurrence of `oldText` with `newText` in `filePath`. */
export async function editFile(filePath: string, oldText: string, newText: string): Promise<void> {
  if (oldText === newText) {
    throw new Error("oldText and newText must differ");
  }

  let content: string;
  try {
    content = await fs.readFile(filePath, "utf8");
  } catch (err) {
    throw new Error(`Could not read file "${filePath}": ${(err as Error).message}`);
  }

  const firstIndex = content.indexOf(oldText);
  if (firstIndex === -1) {
    throw new Error(`oldText not found in "${filePath}"`);
  }
  const secondIndex = content.indexOf(oldText, firstIndex + oldText.length);
  if (secondIndex !== -1) {
    throw new Error(`oldText is not unique in "${filePath}"; it matches multiple locations`);
  }

  const updated = content.slice(0, firstIndex) + newText + content.slice(firstIndex + oldText.length);
  await fs.writeFile(filePath, updated, "utf8");
}

export function registerEditTool(pi: ExtensionAPI) {
  pi.registerTool({
    ...EDIT_TOOL_DEFINITION,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const filePath = resolveSafePath(ctx.cwd, params.path);
      await editFile(filePath, params.oldText, params.newText);

      return {
        content: [{ type: "text", text: `Successfully edited ${params.path}.` }],
        details: {},
      };
    },
  });
}
