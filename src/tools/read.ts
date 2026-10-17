import * as fs from "node:fs/promises";
import { READ_TOOL_DEFINITION } from "../tool_definitions/read.ts";
import type { ToolRegistry } from "../sandbox/permissionGate.ts";
import { sandboxFor, type Sandbox } from "../sandbox/sandbox.ts";
import { oneLine, callName } from "../backend/renderCall.ts";
import { withConciseValidationErrors } from "../backend/toolValidation.ts";
import { peekFile, renderPeekResult } from "./peek.ts";
import type { PeekVisibility } from "./previewManagers/types.ts";
import { PEEK_EXTENSIONS } from "./previewManagers/registry.ts";

const DEFAULT_MAX_LINES = 2000;
const DEFAULT_MAX_BYTES = 50 * 1024; // 50KB

export interface ReadOptions {
  offset?: number;
  limit?: number;
  signal?: AbortSignal;
  peek?: boolean;
  /**
   * Internal only — never exposed as a tool parameter. Skips the DEFAULT_MAX_LINES/DEFAULT_MAX_BYTES
   * output caps so another tool built on top of read (`peek`, which needs the whole file to
   * outline it) gets every line; that tool applies its own cap to what it returns instead.
   */
  uncapped?: boolean;
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
 * Reads `target` (resolved through `sb`) as UTF-8 text and returns it as 1-indexed `{line, text}` pairs — the same line
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
export async function readFile(sb: Sandbox, target: string, opts: ReadOptions = {}): Promise<ReadResult> {
  const filePath = sb.resolve(target);
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

  let endIndex = opts.limit !== undefined ? Math.min(offset + opts.limit - 1, totalLines) : totalLines;

  // Cap by line count.
  if (!opts.uncapped) endIndex = Math.min(endIndex, Math.min(offset + DEFAULT_MAX_LINES - 1, totalLines));

  // Cap by byte size, trimming lines off the end until under the limit (never a partial line).
  let selected = allLines.slice(offset - 1, endIndex);
  while (!opts.uncapped && selected.length > 1 && Buffer.byteLength(selected.join("\n"), "utf8") > DEFAULT_MAX_BYTES) {
    selected = selected.slice(0, -1);
  }
  endIndex = offset - 1 + selected.length;

  return {
    lines: selected.map((text, i) => ({ line: offset - 1 + i + 1, text })),
    totalLines,
    truncated: endIndex < totalLines,
  };
}

export function registerReadTool(pi: ToolRegistry) {
  pi.registerTool({
    ...READ_TOOL_DEFINITION,
    prepareArguments: withConciseValidationErrors(READ_TOOL_DEFINITION.name, READ_TOOL_DEFINITION.parameters),
    renderCall(args, theme) {
      let text = `${callName(theme, "read")} ${theme.fg("accent", args.path ?? "")}`;
      const flags: string[] = [];
      
      // New logic for rendering: Peek flag should be displayed if supported.
      const isPeekSupported = PEEK_EXTENSIONS.has(getExtension(args.path || ""));
      
      if (isPeekSupported) {
        flags.push(args.peek ? "peek" : "no-peek");
      } else {
        // If not supported, always use standard read mode
        flags.push("no-peek");
      }
      
      if (args.offset !== undefined) {
        flags.push(`offset ${args.offset}`);
      }
      if (args.limit !== undefined) {
        flags.push(`limit ${args.limit}`);
      }
      
      if (flags.length > 0) {
        text += theme.fg("toolOutput", ` (${flags.join(", ")})`);
      }
      return oneLine(text);
    },
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const path = params.path ?? "";
      const extension = getExtension(path);
      
      // Use peek functionality only when offset and limit are not set
      // If user provides offset or limit, they want to see specific content, not an outline
      const usePeek = PEEK_EXTENSIONS.includes(extension) &&
                      params.offset === undefined &&
                      params.limit === undefined;
      
      if (usePeek) {
        // Use peek functionality
        const visibility: PeekVisibility = "public";
        const result = await peekFile(sandboxFor(ctx.cwd), params.path, {
          visibility,
          includeDocs: false,
          maxDepth: 6,
          signal,
        });
        return {
          content: [{ type: "text", text: renderPeekResult(params.path, result, visibility) }],
          details: {
            language: result.language,
            shownLines: result.lines.length,
            totalLines: result.totalLines,
            truncated: result.truncated,
          },
        };
      }
      
      // Fallback/Standard read for:
      // - unsupported extensions
      // - when offset or limit are provided (user wants specific content, not outline)
      // - explicit peek=false
      const result = await readFile(sandboxFor(ctx.cwd), params.path, { 
          offset: params.offset, 
          limit: params.limit, 
          signal: signal 
      });

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

/**
 * Helper function to get the file extension from a path.
 */
function getExtension(path: string): string {
  const parts = path.split('.');
  if (parts.length < 2) return "";
  // Join the parts back together to handle names like 'archive.tar.gz'
  const lastDotIndex = Math.max(path.lastIndexOf('.'));
  return lastDotIndex === -1 ? "" : path.substring(lastDotIndex);
}