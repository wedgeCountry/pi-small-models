import * as fs from "node:fs/promises";
import type {ExtensionAPI} from "@earendil-works/pi-coding-agent";
import {EDIT_TOOL_DEFINITION} from "../tool_definitions/edit.ts";
import {resolveSandboxPath} from "../sandbox.ts";
import {withFileMutationQueue} from "../mutationQueue.ts";

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

/**
 * Detects a file's dominant line-ending style from its content, the same heuristic `insertText`
 * uses: any `\r\n` anywhere means treat the whole file as CRLF.
 */
function detectLineEnding(content: string): "\r\n" | "\n" {
  return content.includes("\r\n") ? "\r\n" : "\n";
}

/** Collapses all line endings to bare `\n`, so matching doesn't care whether a string uses CRLF, LF, or bare CR. */
function normalizeToLF(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/** Reintroduces `\r\n` line endings into LF-normalized text, if `ending` calls for it. */
function restoreLineEndings(text: string, ending: "\r\n" | "\n"): string {
  return ending === "\r\n" ? text.replace(/\n/g, "\r\n") : text;
}

/**
 * Applies a single {oldText -> newText} replacement to `content`, returning the updated string.
 *
 * `content`, `oldText`, and `newText` must already be LF-normalized (see `normalizeToLF`) — callers
 * match against a normalized copy of the file so an `oldText` written with bare `\n` line breaks
 * (the overwhelming majority of what models produce) still matches a file that's actually saved
 * with `\r\n`, and restore the file's real line-ending style afterwards.
 */
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
    throw new Error(`${context}: oldText is not unique; it matches multiple locations, use allowMultipleMatches: true if this is desired behaviour!`);
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
 *
 * Matching happens against an LF-normalized copy of the file's content (and of `oldText`/
 * `newText`), so the file's actual line-ending style — CRLF, LF, or a mix — never causes a
 * spurious "oldText not found" when the caller's `oldText` uses plain `\n` breaks, which is the
 * common case for model-generated text. The file's original line-ending style (detected once, up
 * front) is restored across the whole updated content before writing, so a CRLF file stays CRLF
 * even though the edit itself was applied against an LF-normalized view of it.
 *
 * The read-modify-write runs under `withFileMutationQueue` so a concurrent edit/write/insert/
 * remove on the same path can't interleave with it — e.g. read a stale copy of the file after
 * another call has already changed it, then overwrite that call's change.
 */
export async function editFile(
  filePath: string,
  oldText: string,
  newText: string,
  opts: EditOptions = {}
): Promise<void> {
  await withFileMutationQueue(filePath, async () => {
    const content = await readForEdit(filePath, opts.signal);
    const eol = detectLineEnding(content);
    const updated = applyOneEdit(
      normalizeToLF(content),
      { oldText: normalizeToLF(oldText), newText: normalizeToLF(newText), allowMultipleMatches: opts.allowMultipleMatches },
      `oldText in "${filePath}"`
    );
    await fs.writeFile(filePath, restoreLineEndings(updated, eol), { encoding: "utf8", signal: opts.signal });
  });
}

/**
 * Applies several edits to `filePath` in one atomic read-modify-write: each edit is applied in
 * order against the result of the previous one (so offsets stay correct as the file changes),
 * and the file is only written once every edit has succeeded — if any edit fails, the file is
 * left untouched. This is what lets a caller make several disjoint changes to the same file
 * without the second edit's `oldText` going stale the moment the first edit lands.
 *
 * Same LF-normalize-then-restore handling as `editFile`, applied once up front and once at the
 * end rather than per edit, so intermediate edits in the chain also see a normalized view.
 *
 * Also runs under `withFileMutationQueue`, for the same reason as `editFile`.
 */
export async function editFileMulti(
  filePath: string,
  edits: EditSpec[],
  opts: EditMultiOptions = {}
): Promise<void> {
  if (edits.length === 0) {
    throw new Error("edits must contain at least one edit");
  }

  await withFileMutationQueue(filePath, async () => {
    const content = await readForEdit(filePath, opts.signal);
    const eol = detectLineEnding(content);
    let updated = normalizeToLF(content);
    edits.forEach((edit, i) => {
      const context =
        edits.length > 1
          ? `edit ${i + 1} of ${edits.length} in "${filePath}" (an earlier edit in this call may have already changed this text)`
          : `oldText in "${filePath}"`;
      updated = applyOneEdit(
        updated,
        { oldText: normalizeToLF(edit.oldText), newText: normalizeToLF(edit.newText), allowMultipleMatches: edit.allowMultipleMatches },
        context
      );
    });
    await fs.writeFile(filePath, restoreLineEndings(updated, eol), { encoding: "utf8", signal: opts.signal });
  });
}

export function registerEditTool(pi: ExtensionAPI) {
  pi.registerTool({
    ...EDIT_TOOL_DEFINITION,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const filePath = resolveSandboxPath(ctx.cwd, params.path, "edit");
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
