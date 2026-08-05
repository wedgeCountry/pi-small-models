import * as fs from "node:fs/promises";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { EDIT_TOOL_DEFINITION } from "../tool_definitions/edit.ts";
import { resolveSafePath } from "../pathSafety.ts";

export interface EditOptions {
  /** If true, replace every occurrence of oldText instead of requiring a unique match. */
  allowMultipleMatches?: boolean;
  signal?: AbortSignal;
}

export interface EditSpec {
  oldText: string;
  newText: string;
  allowMultipleMatches?: boolean;
}

export interface EditMultiOptions {
  signal?: AbortSignal;
}

/** Applies a single {oldText -> newText} replacement to `content`, returning the updated string. */
function applyOneEdit(content: string, edit: EditSpec, context: string): string {
  const { oldText, newText, allowMultipleMatches } = edit;
  if (oldText.length === 0) {
    throw new Error(
      `${context}: oldText must not be empty. To insert new text without replacing anything, use the insert tool instead.`
    );
  }
  if (oldText === newText) {
    throw new Error(`${context}: oldText and newText must differ`);
  }

  const firstIndex = content.indexOf(oldText);
  if (firstIndex === -1) {
    throw new Error(`${context}: oldText not found`);
  }
  const secondIndex = content.indexOf(oldText, firstIndex + oldText.length);
  if (secondIndex !== -1 && !allowMultipleMatches) {
    throw new Error(`${context}: oldText is not unique; it matches multiple locations`);
  }

  return allowMultipleMatches
    ? content.split(oldText).join(newText)
    : content.slice(0, firstIndex) + newText + content.slice(firstIndex + oldText.length);
}

async function readForEdit(filePath: string, signal?: AbortSignal): Promise<string> {
  try {
    // fs.readFile/writeFile natively honor `signal`, unlike fs.rm/fs.mkdir —
    // no manual abort plumbing needed here.
    return await fs.readFile(filePath, { encoding: "utf8", signal });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).name === "AbortError") throw err;
    throw new Error(`Could not read file "${filePath}": ${(err as Error).message}`);
  }
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
  const content = await readForEdit(filePath, opts.signal);
  const updated = applyOneEdit(
    content,
    { oldText, newText, allowMultipleMatches: opts.allowMultipleMatches },
    `oldText in "${filePath}"`
  );
  await fs.writeFile(filePath, updated, { encoding: "utf8", signal: opts.signal });
}

/**
 * Applies several edits to `filePath` in one atomic read-modify-write: each edit is applied in
 * order against the result of the previous one (so offsets stay correct as the file changes),
 * and the file is only written once every edit has succeeded — if any edit fails, the file is
 * left untouched. This is what lets a caller make several disjoint changes to the same file
 * without the second edit's `oldText` going stale the moment the first edit lands.
 */
export async function editFileMulti(
  filePath: string,
  edits: EditSpec[],
  opts: EditMultiOptions = {}
): Promise<void> {
  if (edits.length === 0) {
    throw new Error("edits must contain at least one edit");
  }

  const content = await readForEdit(filePath, opts.signal);
  let updated = content;
  edits.forEach((edit, i) => {
    const context =
      edits.length > 1
        ? `edit ${i + 1} of ${edits.length} in "${filePath}" (an earlier edit in this call may have already changed this text)`
        : `oldText in "${filePath}"`;
    updated = applyOneEdit(updated, edit, context);
  });
  await fs.writeFile(filePath, updated, { encoding: "utf8", signal: opts.signal });
}

export function registerEditTool(pi: ExtensionAPI) {
  pi.registerTool({
    ...EDIT_TOOL_DEFINITION,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const filePath = resolveSafePath(ctx.cwd, params.path);
      const hasSingle = params.oldText !== undefined || params.newText !== undefined;
      const hasBatch = params.edits !== undefined;

      if (hasSingle && hasBatch) {
        throw new Error("Specify either oldText/newText or edits, not both.");
      }

      if (hasBatch) {
        await editFileMulti(filePath, params.edits!, { signal });
        return {
          content: [
            { type: "text", text: `Successfully applied ${params.edits!.length} edit(s) to ${params.path}.` },
          ],
          details: {},
        };
      }

      if (params.oldText === undefined || params.newText === undefined) {
        throw new Error("Specify either oldText and newText, or a non-empty edits array.");
      }
      await editFile(filePath, params.oldText, params.newText, {
        allowMultipleMatches: params.allowMultipleMatches,
        signal,
      });

      return {
        content: [{ type: "text", text: `Successfully edited ${params.path}.` }],
        details: {},
      };
    },
  });
}
