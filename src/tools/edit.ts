import * as fs from "node:fs/promises";
import {EDIT_TOOL_DEFINITION} from "../tool_definitions/edit.ts";
import type { ToolRegistry } from "../sandbox/permissionGate.ts";
import {sandboxFor, type Sandbox} from "../sandbox/sandbox.ts";
import {withFileMutationQueue} from "../mutationQueue.ts";
import {oneLine, callName} from "../renderCall.ts";
import { withConciseValidationErrors } from "../toolValidation.ts";

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

/** One edit in a batch that failed to apply, by its (0-indexed) position in the `edits` array. */
export interface EditFailure {
  index: number;
  error: string;
}

export interface EditMultiResult {
  /** How many of the edits were successfully applied and persisted to disk. */
  applied: number;
  /** Total number of edits requested. */
  total: number;
  /** Edits that failed, in the order they were attempted. Edits not in this list succeeded. */
  failures: EditFailure[];
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
 * Replaces `oldText` with `newText` in `target` (resolved through `sb`). By default `oldText` must match exactly
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
  sb: Sandbox,
  target: string,
  oldText: string,
  newText: string,
  opts: EditOptions = {}
): Promise<void> {
  const filePath = sb.resolve(target);

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
 * Applies several edits to `target` (resolved through `sb`) in one read-modify-write, applying as many as possible:
 * each edit is attempted in order against the result of the previous *successful* edit (so
 * offsets stay correct as the file changes), and a failing edit is skipped and recorded rather
 * than aborting the whole batch. The file is written once, at the end, with every successful
 * edit applied — unless none succeeded, in which case the file is left untouched. The returned
 * `EditMultiResult` reports how many edits applied and the error for each one that didn't, so a
 * caller can retry just the failed edits without redoing the ones that already landed.
 *
 * Same LF-normalize-then-restore handling as `editFile`, applied once up front and once at the
 * end rather than per edit, so intermediate edits in the chain also see a normalized view.
 *
 * Also runs under `withFileMutationQueue`, for the same reason as `editFile`.
 */
export async function editFileMulti(
  sb: Sandbox,
  target: string,
  edits: EditSpec[],
  opts: EditMultiOptions = {}
): Promise<EditMultiResult> {
  if (edits.length === 0) {
    throw new Error("edits must contain at least one edit");
  }

  const filePath = sb.resolve(target);

  return withFileMutationQueue(filePath, async () => {
    const content = await readForEdit(filePath, opts.signal);
    const eol = detectLineEnding(content);
    let updated = normalizeToLF(content);
    const failures: EditFailure[] = [];

    for (let i = 0; i < edits.length; i++) {
      const edit = edits[i]!;
      const context =
        edits.length > 1
          ? `edit ${i + 1} of ${edits.length} in "${filePath}" (an earlier edit in this call may have already changed this text)`
          : `oldText in "${filePath}"`;
      try {
        updated = applyOneEdit(
          updated,
          { oldText: normalizeToLF(edit.oldText), newText: normalizeToLF(edit.newText), allowMultipleMatches: edit.allowMultipleMatches },
          context
        );
      } catch (err) {
        failures.push({ index: i, error: (err as Error).message });
      }
    }

    const applied = edits.length - failures.length;
    if (applied > 0) {
      await fs.writeFile(filePath, restoreLineEndings(updated, eol), { encoding: "utf8", signal: opts.signal });
    }
    return { applied, total: edits.length, failures };
  });
}

export function registerEditTool(pi: ToolRegistry) {
  pi.registerTool({
    ...EDIT_TOOL_DEFINITION,
    prepareArguments: withConciseValidationErrors(EDIT_TOOL_DEFINITION.name, EDIT_TOOL_DEFINITION.parameters),
    renderCall(args, theme) {
      let text = `${callName(theme, "edit")} ${theme.fg("accent", args.path ?? "")}`;
      text += theme.fg("toolOutput", args.edits ? ` (${args.edits.length} edits)` : "");
      return oneLine(text);
    },
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const sb = sandboxFor(ctx.cwd);
      const hasSingle = params.oldText !== undefined || params.newText !== undefined;
      const hasBatch = params.edits !== undefined;

      if (hasSingle && hasBatch) {
        throw new Error("Specify either oldText/newText or edits, not both.");
      }

      if (hasBatch) {
        const result = await editFileMulti(sb, params.path, params.edits!, { signal });
        const lines = [`Applied ${result.applied} of ${result.total} edit(s) to ${params.path}.`];
        if (result.failures.length > 0) {
          lines.push("Failed edits:");
          for (const failure of result.failures) {
            lines.push(`  edit ${failure.index + 1}: ${failure.error}`);
          }
        }
        return {
          content: [{ type: "text", text: lines.join("\n") }],
          details: { applied: result.applied, total: result.total, failures: result.failures },
        };
      }

      if (params.oldText === undefined || params.newText === undefined) {
        throw new Error("Specify either oldText and newText, or a non-empty edits array.");
      }
      await editFile(sb, params.path, params.oldText, params.newText, {
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
