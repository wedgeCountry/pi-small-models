import * as fs from "node:fs/promises";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { EDIT_TOOL_DEFINITION } from "../tool_definitions/edit.ts";
import { resolveSafePath } from "../pathSafety.ts";

export interface EditOptions {
  /** If true, replace every occurrence of oldText instead of requiring a unique match. */
  allowMultipleMatches?: boolean;
}

/**
 * Replaces `oldText` with `newText` in `filePath`. By default `oldText` must match exactly
 * one location, or an error is thrown; pass `allowMultipleMatches: true` to replace all
 * occurrences instead.
 */
export async function editFile(
  filePath: string,
  oldText: string,
  newText: string,
  opts: EditOptions = {}
): Promise<void> {
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
  if (secondIndex !== -1 && !opts.allowMultipleMatches) {
    throw new Error(`oldText is not unique in "${filePath}"; it matches multiple locations`);
  }

  const updated = opts.allowMultipleMatches
    ? content.split(oldText).join(newText)
    : content.slice(0, firstIndex) + newText + content.slice(firstIndex + oldText.length);
  await fs.writeFile(filePath, updated, "utf8");
}

export function registerEditTool(pi: ExtensionAPI) {
  pi.registerTool({
    ...EDIT_TOOL_DEFINITION,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const filePath = resolveSafePath(ctx.cwd, params.path);
      await editFile(filePath, params.oldText, params.newText, {
        allowMultipleMatches: params.allowMultipleMatches,
      });

      return {
        content: [{ type: "text", text: `Successfully edited ${params.path}.` }],
        details: {},
      };
    },
  });
}
