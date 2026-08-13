import * as fs from "node:fs/promises";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { READ_TOOL_DEFINITION } from "../tool_definitions/read.ts";
import { resolveSandboxPath } from "../sandbox.ts";
import { oneLine, callName } from "../renderCall.ts";

const DEFAULT_MAX_LINES = 2000;
const DEFAULT_MAX_BYTES = 50 * 1024; // 50KB

export interface ReadOptions {
  offset?: number;
  limit?: number;
  signal?: AbortSignal;
}

export interface ReadLine {
  line: number;
  text: string;
}

export interface ReadResult {
  lines: ReadLine[];
  totalLines: number;
  truncated: boolean;
}

/**
 * Reads `filePath` as UTF-8 text and returns it as 1-indexed `{line, text}` pairs — the same line
 * numbering `grep` reports and `insert` expects, so a model can chain grep -> read -> insert calls
 * against consistent line numbers. Lines are split on `\r\n`/`\n` the same way `insertText` does,
 * so a file's reported line count (and therefore valid `offset`/`insert` targets) agree between
 * the two tools.
 *
 * `offset` (1-indexed, default 1) and `limit` select a line range. On top of that, output is
 * additionally capped at DEFAULT_MAX_LINES lines / DEFAULT_MAX_BYTES bytes (whichever is hit
 * first) so one call can't flood a small model's context with an enormous file; `truncated` is set
 * whenever the returned range stops short of the file's last line — whether that's because a cap
 * kicked in or because the caller's own `limit` did — and the last returned line number tells the
 * caller where to resume with a follow-up `offset`.
 */
export async function readFile(filePath: string, opts: ReadOptions = {}): Promise<ReadResult> {
  if (opts.offset !== undefined && (!Number.isInteger(opts.offset) || opts.offset < 1)) {
    throw new Error(`offset must be a positive integer, got ${opts.offset}`);
  }
  if (opts.limit !== undefined && (!Number.isInteger(opts.limit) || opts.limit < 1)) {
    throw new Error(`limit must be a positive integer, got ${opts.limit}`);
  }

  let buffer: Buffer;
  try {
    // fs.readFile natively honors `signal`, unlike fs.rm/fs.mkdir — no manual abort plumbing
    // needed here.
    buffer = await fs.readFile(filePath, { signal: opts.signal });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).name === "AbortError") throw err;
    throw new Error(`Could not read file "${filePath}": ${(err as Error).message}`);
  }

  const allLines = buffer.toString("utf8").split(/\r\n|\n/);
  const totalLines = allLines.length;

  const offset = opts.offset ?? 1;
  if (offset > totalLines) {
    throw new Error(`Offset ${offset} is beyond end of file (${totalLines} line(s) total)`);
  }

  const startIndex = offset - 1;
  let endIndex = opts.limit !== undefined ? Math.min(startIndex + opts.limit, totalLines) : totalLines;

  // Cap by line count.
  endIndex = Math.min(endIndex, startIndex + DEFAULT_MAX_LINES);

  // Cap by byte size, trimming lines off the end until under the limit (never a partial line).
  let selected = allLines.slice(startIndex, endIndex);
  while (selected.length > 1 && Buffer.byteLength(selected.join("\n"), "utf8") > DEFAULT_MAX_BYTES) {
    selected = selected.slice(0, -1);
  }
  endIndex = startIndex + selected.length;

  return {
    lines: selected.map((text, i) => ({ line: startIndex + i + 1, text })),
    totalLines,
    truncated: endIndex < totalLines,
  };
}

export function registerReadTool(pi: ExtensionAPI) {
  pi.registerTool({
    ...READ_TOOL_DEFINITION,
    renderCall(args, theme) {
      let text = `${callName(theme, "read")} ${theme.fg("accent", args.path ?? "")}`;
      if (args.offset !== undefined || args.limit !== undefined) {
        const start = args.offset ?? 1;
        const end = args.limit !== undefined ? start + args.limit - 1 : undefined;
        text += theme.fg("toolOutput", `:${start}${end !== undefined ? `-${end}` : "+"}`);
      }
      return oneLine(text);
    },
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const filePath = resolveSandboxPath(ctx.cwd, params.path, "read");
      const result = await readFile(filePath, { offset: params.offset, limit: params.limit, signal });

      let text = result.lines.map((l) => `${l.line}:${l.text}`).join("\n");
      if (result.truncated) {
        const lastLine = result.lines[result.lines.length - 1]!.line;
        text += `\n\n[Showing lines ${result.lines[0]!.line}-${lastLine} of ${result.totalLines}. Use offset=${lastLine + 1} to continue.]`;
      }

      return {
        content: [{ type: "text", text }],
        details: { totalLines: result.totalLines, truncated: result.truncated },
      };
    },
  });
}
