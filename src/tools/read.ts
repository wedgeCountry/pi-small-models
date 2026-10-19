import * as fs from "node:fs/promises";
import * as path from "node:path";
import { READ_TOOL_DEFINITION } from "../tool_definitions/read.ts";
import type { ToolRegistry } from "../sandbox/permissionGate.ts";
import { sandboxFor, type Sandbox } from "../sandbox/sandbox.ts";
import { oneLine, callName } from "../backend/renderCall.ts";
import { withConciseValidationErrors } from "../backend/toolValidation.ts";
import { createReadTool, type ReadToolResult } from "@earendil-works/pi-coding-agent";

// Maximum lines to return from a read operation to prevent context flooding
const MAX_READ_LINES = 2000;
// Maximum bytes to return from a read operation to prevent context flooding
// 50KB provides a reasonable balance between context and performance
const MAX_READ_BYTES = 50 * 1024;

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
   * Internal only — never exposed as a tool parameter. Skips the MAX_READ_LINES/MAX_READ_BYTES
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
 * additionally capped at MAX_READ_LINES lines / MAX_READ_BYTES bytes (whichever is hit
 * first) so one call can't flood a small model's context with an enormous file; `truncated` is set
 * whenever the returned range stops short of the file's last line — whether that's because a cap
 * kicked in or because the caller's own `limit` did — and the last returned line number tells the
 * caller where to resume with a follow-up `offset`.
 */
export async function readFile(sb: Sandbox, target: string, opts: ReadOptions = {}): Promise<ReadResult> {
  const filePath = sb.resolve(target);
  if (opts.offset !== undefined && (!Number.isInteger(opts.offset) || opts.offset < 1)) {
    throw new RangeError(`offset must be a positive integer, got ${opts.offset}`);
  }
  if (opts.limit !== undefined && (!Number.isInteger(opts.limit) || opts.limit < 1)) {
    throw new RangeError(`limit must be a positive integer, got ${opts.limit}`);
  }

  // Handle images using SDK read tool
  if (IMAGE_EXTENSIONS.has(getExtension(filePath || ""))) {
    if (opts.offset !== undefined || opts.limit !== undefined) {
      throw new RangeError(`offset and limit are not allowed for image files`);
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
    const textContent = sdkResult.content.find((c: ReadToolResult) => c.type === "text")?.text || `[Image file: ${filePath}]`;
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
    throw new TypeError(`Could not read file "${relPath}": ${errMsg}`);
  }

  const allLines = buffer.toString("utf8").split(/\r\n|\n/);
  const totalLines = allLines.length;

  const offset = opts.offset ?? 1;
  if (offset > totalLines) {
    throw new RangeError(`Offset ${offset} is beyond end of file (${totalLines} line(s) total)`);
  }

  const startIndex = offset - 1;
  let endIndex = opts.limit !== undefined ? Math.min(startIndex + opts.limit, totalLines) : totalLines;

  // Cap by line count.
  if (!opts.uncapped) endIndex = Math.min(endIndex, startIndex + MAX_READ_LINES);

  // Cap by byte size, trimming lines off the end until under the limit (never a partial line).
  let selected = allLines.slice(startIndex, endIndex);
  while (!opts.uncapped && selected.length > 0 && Buffer.byteLength(selected.join("\n"), "utf8") > MAX_READ_BYTES) {
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
      const result = await readFile(sandboxFor(ctx.cwd), params.path, { offset: params.offset, limit: params.limit, signal });

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