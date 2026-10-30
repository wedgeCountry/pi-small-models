import * as fs from "node:fs/promises";
import {EDIT_TOOL_DEFINITION} from "../tool_definitions/edit.ts";
import type { ToolRegistry } from "../sandbox/permissionGate.ts";
import {sandboxFor, type Sandbox} from "../sandbox/sandbox.ts";
import {withFileMutationQueue} from "../backend/mutationQueue.ts";
import {oneLine, callName} from "../backend/renderCall.ts";
import { withConciseValidationErrors } from "../backend/toolValidation.ts";
import { toolOutput } from "../backend/toolOutput.ts";
import { toolError } from "../backend/formatError.ts";

export interface EditOptions {
  /** If true, replace every occurrence of oldText instead of requiring a unique match. */
  allowMultipleMatches?: boolean;
  signal?: AbortSignal;
}

export interface EditSpec {
  oldText: string;
  newText: string;
  allowMultipleMatches?: boolean;
  /**
   * Skips the code-fence rejection below. Set only for markdown targets when the fence-wrapped
   * oldText genuinely occurs in the file (or for the stripped retry) — there, fences are content,
   * not model formatting.
   */
  allowFencedText?: boolean;
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

const FENCE_LINE = /^```/;

/**
 * Detects whether `text` is a whole markdown code block — i.e. wrapped in triple-backtick
 * fences — which is how models sometimes hand over code when they forget to strip the markdown
 * formatting from tool arguments. Left in place, the fences would be written into the file
 * verbatim (or, for oldText, cause a confusing "oldText not found"), so callers reject the edit
 * with an actionable message instead. Only a text whose first and last lines are fences, with no
 * other fence lines between them, counts; fences that are merely part of the file's actual
 * content are left alone.
 */
function detectCodeFence(text: string): boolean {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines.length < 2 || !FENCE_LINE.test(lines[0]!) || !FENCE_LINE.test(lines[lines.length - 1]!)) {
    return false;
  }
  return lines.slice(1, -1).every((line) => !FENCE_LINE.test(line));
}

/**
 * Removes the outer code fences from `text` (whose presence `detectCodeFence` confirmed), keeping
 * the inner lines verbatim and preserving the original line-ending style of the inner content.
 */
function unwrapCodeFence(text: string): string {
  const usedCrlf = text.includes("\r\n");
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const inner = lines.slice(1, -1);
  return usedCrlf ? inner.join("\r\n") : inner.join("\n");
}


/**
 * Applies a single {oldText -> newText} replacement to `content`, returning the updated string.
 *
 * `content`, `oldText`, and `newText` must already be LF-normalized (see `normalizeToLF`) and
 * Unicode-normalized (see `normalizeUnicodeEscapes`) — callers match against a normalized copy
 * of the file so an `oldText` written with bare `\n` line breaks and/or actual Unicode characters
 * (the common case for model-generated text) still matches a file that's actually saved with
 * `\r\n` and/or Unicode escape sequences, and restore the file's real line-ending style afterwards.
 */
function applyOneEdit(content: string, edit: EditSpec, context: string, params: Record<string, unknown>): string {
  const { oldText, newText, allowMultipleMatches } = edit;
  if (oldText.length === 0) {
    throw toolError(
      "edit",
      `${context}: oldText must not be empty. To insert new text without replacing anything, use the insert tool instead.`,
      params
    );
  }
  if (newText.length === 0) {
    throw toolError(
      "edit",
      `${context}: newText must not be empty. To delete text, use the remove tool instead.`,
      params
    );
  }
  if (oldText === newText) {
    throw toolError("edit", `${context}: oldText and newText must differ`, params);
  }
  if (detectCodeFence(oldText) && !edit.allowFencedText) {
    throw toolError(
      "edit",
      `${context}: oldText appears to be wrapped in a markdown code block (triple backticks). ` +
        `Strip the \`\`\` fences and pass only the plain file content — the code block formatting is not part of the file. ` +
        `If the fences genuinely belong in a markdown file, include surrounding non-fence lines in oldText.`,
      params
    );
  }
  if (detectCodeFence(newText) && !edit.allowFencedText) {
    throw toolError(
      "edit",
      `${context}: newText appears to be wrapped in a markdown code block (triple backticks). ` +
        `Strip the \`\`\` fences and pass only the plain file content, otherwise the fences get written into the file. ` +
        `If the fences genuinely belong in a markdown file, include surrounding non-fence lines in newText.`,
      params
    );
  }

  const firstIndex = content.indexOf(oldText);
  if (firstIndex === -1) {
    throw toolError("edit", `${context}: oldText not found`, params);
  }
  const secondIndex = content.indexOf(oldText, firstIndex + oldText.length);
  if (secondIndex !== -1 && !allowMultipleMatches) {
    throw toolError(
      "edit",
      `${context}: oldText is not unique; it matches multiple locations, use allowMultipleMatches: true if this is desired behaviour!`,
      params
    );
  }

  return allowMultipleMatches
    ? content.split(oldText).join(newText)
    : content.slice(0, firstIndex) + newText + content.slice(firstIndex + oldText.length);
}

async function readForEdit(filePath: string, target: string, signal?: AbortSignal): Promise<string> {
  try {
    // fs.readFile/writeFile natively honor `signal`, unlike fs.rm/fs.mkdir —
    // no manual abort plumbing needed here.
    return await fs.readFile(filePath, { encoding: "utf8", signal });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).name === "AbortError") throw err;
    throw toolError("edit", `Could not read file "${filePath}": ${(err as Error).message}`, { path: target });
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
    const content = await readForEdit(filePath, target, opts.signal);
    const eol = detectLineEnding(content);

    // Normalize line endings for both content and edit parameters
    const lfContent = normalizeToLF(content);
    const lfOldText = normalizeToLF(oldText);
    const lfNewText = normalizeToLF(newText);

    // Markdown files legitimately consist of (or contain) fenced code blocks, so the
    // model-error heuristic ("arguments accidentally wrapped in fences") must not reject
    // fence-shaped text when the target file is markdown. There, genuine content wins: the
    // verbatim fence-wrapped text is tried first, and only when it is not found does the edit
    // fall back to the stripped form (the model probably wrapped its arguments after all).
    const isMarkdownTarget = /\.(?:md|markdown|mdx)$/i.test(target);
    const applyEdit = (
      editContent: string,
      spec: EditSpec,
      context: string,
      params: Record<string, unknown>
    ): string => {
      if (!isMarkdownTarget) return applyOneEdit(editContent, spec, context, params);
      // Genuine content wins: if the verbatim fence-wrapped oldText is actually in the file,
      // apply the edit as given. Only when it is absent do we retry with the fences stripped —
      // the model probably wrapped its arguments after all — and only then surface an error.
      if (
        spec.oldText.length > 0 &&
        detectCodeFence(spec.oldText) &&
        editContent.includes(spec.oldText)
      ) {
        return applyOneEdit(editContent, { ...spec, allowFencedText: true }, context, params);
      }
      const strippedOld = spec.oldText.length > 0 && detectCodeFence(spec.oldText) ? unwrapCodeFence(spec.oldText) : spec.oldText;
      const strippedNew = spec.newText.length > 0 && detectCodeFence(spec.newText) ? unwrapCodeFence(spec.newText) : spec.newText;
      if (strippedOld !== spec.oldText || strippedNew !== spec.newText) {
        if (strippedOld.length > 0 && strippedNew.length > 0 && strippedOld !== strippedNew) {
          return applyOneEdit(editContent, { ...spec, oldText: strippedOld, newText: strippedNew, allowFencedText: true }, context, params);
        }
      }
      return applyOneEdit(editContent, spec, context, params);
    };

    // Apply the edit using LF-normalized content and text
    const updated = applyEdit(
      lfContent,
      { oldText: lfOldText, newText: lfNewText, allowMultipleMatches: opts.allowMultipleMatches },
      `oldText in "${filePath}"`,
      {
        path: target,
        oldText,
        newText,
        allowMultipleMatches: opts.allowMultipleMatches,
      }
    );
    
    await fs.writeFile(filePath, restoreLineEndings(updated, eol), { encoding: "utf8", signal: opts.signal });
  });
}

export function registerEditTool(pi: ToolRegistry) {
  pi.registerTool({
    ...EDIT_TOOL_DEFINITION,
    prepareArguments: withConciseValidationErrors(EDIT_TOOL_DEFINITION.name, EDIT_TOOL_DEFINITION.parameters),
    renderCall(args, theme) {
      let text = `${callName(theme, "edit")} ${theme.fg("accent", args.path ?? "")}`;
      text += theme.fg("toolOutput", "");
      return oneLine(text);
    },
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const sb = sandboxFor(ctx.cwd);
      const hasSingle = params.oldText !== undefined || params.newText !== undefined;

      if (params.oldText === undefined || params.newText === undefined) {
        throw toolError("edit", "Specify oldText and newText", { path: params.path });
      }
      await editFile(sb, params.path, params.oldText, params.newText, {
        allowMultipleMatches: params.allowMultipleMatches,
        signal,
      });

      return toolOutput({}, `Successfully edited ${params.path}.`);
    },
  });
}
