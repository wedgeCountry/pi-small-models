import * as fs from "node:fs/promises";
import { INSERT_TOOL_DEFINITION } from "../tool_definitions/insert.ts";
import type { ToolRegistry } from "../sandbox/permissionGate.ts";
import { sandboxFor, type Sandbox } from "../sandbox/sandbox.ts";
import { withFileMutationQueue } from "../mutationQueue.ts";
import { oneLine, callName } from "../renderCall.ts";
import { withConciseValidationErrors } from "../toolValidation.ts";

export interface InsertOptions {
  signal?: AbortSignal;
}

/**
 * Inserts `text` into `target` (resolved through `sb`) after the given 1-indexed `line` (0 inserts before the first
 * line).
 *
 * The read-modify-write runs under `withFileMutationQueue` so a concurrent edit/write/insert/
 * remove on the same path can't interleave with it.
 */
export async function insertText(sb: Sandbox, target: string, line: number, text: string, opts: InsertOptions = {}): Promise<void> {
  if (!Number.isInteger(line) || line < 0) {
    throw new Error(`line must be a non-negative integer, got ${line}`);
  }

  const filePath = sb.resolve(target);

  await withFileMutationQueue(filePath, async () => {
    let content: string;
    try {
      // fs.readFile/writeFile natively honor `signal`, unlike fs.rm/fs.mkdir —
      // no manual abort plumbing needed here.
      content = await fs.readFile(filePath, { encoding: "utf8", signal: opts.signal });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).name === "AbortError") throw err;
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
    await fs.writeFile(filePath, lines.join(eol), { encoding: "utf8", signal: opts.signal });
  });
}

export function registerInsertTool(pi: ToolRegistry) {
  pi.registerTool({
    ...INSERT_TOOL_DEFINITION,
    prepareArguments: withConciseValidationErrors(INSERT_TOOL_DEFINITION.name, INSERT_TOOL_DEFINITION.parameters),
    renderCall(args, theme) {
      const text = `${callName(theme, "insert")} ${theme.fg("accent", args.path ?? "")}`;
      return oneLine(text + theme.fg("toolOutput", ` after line ${args.line}`));
    },
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      await insertText(sandboxFor(ctx.cwd), params.path, params.line, params.text, { signal });

      return {
        content: [{ type: "text", text: `Inserted text into ${params.path} after line ${params.line}.` }],
        details: {},
      };
    },
  });
}
