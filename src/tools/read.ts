import * as fs from "node:fs/promises";
import * as path from "node:path";
import { READ_TOOL_DEFINITION } from "../tool_definitions/read.ts";
import type { ToolRegistry } from "../sandbox/permissionGate.ts";
import { sandboxFor, type Sandbox } from "../sandbox/sandbox.ts";
import { oneLine, callName } from "../backend/renderCall.ts";
import { withConciseValidationErrors } from "../backend/toolValidation.ts";
import { createReadTool } from "@earendil-works/pi-coding-agent";
import { peekFile, renderPeekResult } from "./peek.ts";
import type { PeekVisibility } from "./previewManagers/types.ts";

const DEFAULT_MAX_LINES = 2000;
const DEFAULT_MAX_BYTES = 50 * 1024; // 50KB

/**
 * Decodes `buffer` to text, honoring BOMs so UTF-8/UTF-16 files keep their real characters
 * instead of mojibake: a UTF-8 BOM is stripped, UTF-16LE/BE are decoded via their BOM.
 * Throws when the buffer looks like binary data (NUL byte), so the model gets a clear
 * error instead of silently corrupted replacement characters.
 */
function decodeBuffer(buffer: Buffer, filePath: string): string {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.subarray(3).toString("utf8");
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.subarray(2).toString("utf16le");
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return swap16(buffer.subarray(2)).toString("utf16le");
  }
  if (buffer.includes(0)) {
    throw new Error(`Could not read "${filePath}": it looks like a binary file.`);
  }
  return buffer.toString("utf8");
}

function swap16(buf: Buffer): Buffer {
  const out = Buffer.allocUnsafe(buf.length - (buf.length % 2));
  for (let i = 0; i + 1 < buf.length; i += 2) {
    out[i] = buf[i + 1]!;
    out[i + 1] = buf[i]!;
  }
  return out;
}

const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".bmp",
  ".webp",
  ".svg",
  ".ico",
  ".tiff",
  ".avif",
]);

export interface ReadOptions {
  offset?: number;
  limit?: number;
  signal?: AbortSignal;
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

  // Handle images using SDK read tool
  if (IMAGE_EXTENSIONS.has(getExtension(filePath || ""))) {
    if (opts.offset !== undefined || opts.limit !== undefined) {
      throw new Error(`offset and limit are not allowed for image files`);
    }

    // Create SDK read tool with custom operations that use our sandbox
    const sdkRead = createReadTool(sb.root, {
      autoResizeImages: true
    });

    // Call execute with proper parameters
    const sdkResult = await sdkRead.execute(
      "", // toolCallId (not used)
      { path: filePath }, // parameters
      opts.signal, // signal
      undefined, // onUpdate (not needed)
    );

    // Convert SDK result to ReadResult
    // For images, we return a single line indicating it's an image
    // since readFile is designed for text-based line content
    const textContent = (sdkResult.content.find((c: any) => c.type === "text") as { text: string } | undefined)?.text || `[Image file: ${filePath}]`;
    return {
      lines: [{ line: 1, text: textContent }],
      totalLines: 1,
      truncated: false,
    };
  }


  let buffer: Buffer;
  try {
    // fs.readFile natively honors `signal`, unlike fs.rm/fs.mkdir — no manual abort plumbing
    // needed here.
    buffer = await fs.readFile(filePath, { signal: opts.signal });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).name === "AbortError") throw err;
    // Use relative path to avoid exposing absolute host path
    const relPath = path.relative(sb.root, filePath);
    const errMsg = (err as NodeJS.ErrnoException).message.replace(filePath, relPath);
    throw new Error(`Could not read file "${relPath}": ${errMsg}`);
  }

  const allLines = decodeBuffer(buffer, path.relative(sb.root, filePath)).split(/\r\n|\n/);
  const totalLines = allLines.length;

  const offset = opts.offset ?? 1;
  if (offset > totalLines) {
    throw new Error(`Offset ${offset} is beyond end of file (${totalLines} line(s) total)`);
  }

  const startIndex = offset - 1;
  let endIndex = opts.limit !== undefined ? Math.min(startIndex + opts.limit, totalLines) : totalLines;

  // Cap by line count.
  if (!opts.uncapped) endIndex = Math.min(endIndex, startIndex + DEFAULT_MAX_LINES);

  // Cap by byte size, trimming lines off the end until under the limit (never a partial line).
  let selected = allLines.slice(startIndex, endIndex);
  while (!opts.uncapped && selected.length > 0 && Buffer.byteLength(selected.join("\n"), "utf8") > DEFAULT_MAX_BYTES) {
    selected = selected.slice(0, -1);
  }
  endIndex = startIndex + selected.length;

  return {
    lines: selected.map((text, i) => ({ line: startIndex + i + 1, text })),
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
      if (args.offset !== undefined || args.limit !== undefined) {
        const start = args.offset ?? 1;
        const end = args.limit !== undefined ? start + args.limit - 1 : undefined;
        text += theme.fg("toolOutput", `:${start}${end !== undefined ? `-${end}` : "+"}`);
      }
      return oneLine(text);
    },
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const sb = sandboxFor(ctx.cwd);

      // `peek` defaults to true: without offset/limit, return the file's structural outline
      // instead of its raw contents. Unsupported extensions fall through to a full read, and
      // offset/limit always force raw contents (a range of an outline is meaningless).
      if (params.peek !== false && params.offset === undefined && params.limit === undefined) {
        try {
          const visibility = (params.visibility ?? "public") as PeekVisibility;
          const result = await peekFile(sb, params.path, {
            visibility,
            includeDocs: params.includeDocs,
            maxDepth: params.maxDepth,
            signal,
          });
          return {
            content: [{ type: "text", text: renderPeekResult(params.path, result, visibility) }],
            details: {
              peek: true,
              language: result.language,
              shownLines: result.lines.length,
              totalLines: result.totalLines,
              truncated: result.truncated,
            },
          };
        } catch (err) {
          if (!/does not support/.test((err as Error).message)) throw err;
        }
      }

      const result = await readFile(sb, params.path, { offset: params.offset, limit: params.limit, signal });

      let text = result.lines.map((l) => `${l.line}:${l.text}`).join("\n");
      if (result.truncated) {
        const lastLine = result.lines[result.lines.length - 1]!.line;
        text += `\n\n[Showing lines ${result.lines[0]!.line}-${lastLine} of ${result.totalLines}. Use offset=${lastLine + 1} to continue.]`;
      }

      return {
        content: [{ type: "text", text }],
        details: { peek: false, totalLines: result.totalLines, truncated: result.truncated },
      };
    },
  });
}

/**
 * Helper function to get the file extension from a path.
 */
export function getExtension(p: string): string {
  const lastDotIndex = p.lastIndexOf(".");
  if (lastDotIndex === -1) return "";
  return p.substring(lastDotIndex).toLowerCase();
}