import * as fs from "node:fs/promises";
import * as path from "node:path";
import { READ_TOOL_DEFINITION } from "../tool_definitions/read.ts";
import type { ToolRegistry } from "../sandbox/permissionGate.ts";
import { sandboxFor, type Sandbox } from "../sandbox/sandbox.ts";
import { renderLine } from "../backend/renderCall.ts";
import { createTool } from "../backend/createTool.ts";
import { toolError, isToolFormattedError } from "../backend/formatError.ts";
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
    throw toolError("read", `Could not read "${filePath}": it looks like a binary file.`, { path: filePath });
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
    throw toolError("read", `offset must be a positive integer, got ${opts.offset}`, { path: target, offset: opts.offset });
  }
  if (opts.limit !== undefined && (!Number.isInteger(opts.limit) || opts.limit < 1)) {
    throw toolError("read", `limit must be a positive integer, got ${opts.limit}`, { path: target, limit: opts.limit });
  }

  // Handle images using SDK read tool
  if (IMAGE_EXTENSIONS.has(getExtension(filePath || ""))) {
    if (opts.offset !== undefined || opts.limit !== undefined) {
      throw toolError("read", `offset and limit are not allowed for image files`, {
        path: target,
        ...(opts.offset !== undefined ? { offset: opts.offset } : {}),
        ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
      });
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


  const relPath = path.relative(sb.root, filePath);
  const fail = (err: unknown): never => {
    if ((err as NodeJS.ErrnoException).name === "AbortError") throw err;
    if (isToolFormattedError(err)) throw err;
    throw toolError("read", `Could not read file "${relPath}": ${describeReadError(err as NodeJS.ErrnoException)}`, {
      path: target,
      ...(opts.offset !== undefined ? { offset: opts.offset } : {}),
      ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
    });
  };

  const offset = opts.offset ?? 1;
  const maxLines = opts.uncapped ? Infinity : opts.limit !== undefined ? opts.limit : DEFAULT_MAX_LINES;
  const maxBytes = opts.uncapped ? Infinity : DEFAULT_MAX_BYTES;

  // Capped, non-UTF-16 reads stream: an offset/limit read of a multi-GB log must not allocate a
  // multi-GB buffer. `uncapped` (peek) genuinely needs every line, and UTF-16 needs whole-buffer
  // BOM handling, so those keep the whole-file path.
  if (!opts.uncapped && !(await looksUtf16(filePath))) {
    try {
      return await readFileStreaming(filePath, relPath, { offset, maxLines, maxBytes, signal: opts.signal });
    } catch (err) {
      if (err instanceof StreamingBinaryError) {
        throw toolError("read", `Could not read file "${relPath}": it looks like a binary file.`, { path: target });
      }
      return fail(err);
    }
  }

  let buffer: Buffer;
  try {
    // fs.readFile natively honors `signal`, unlike fs.rm/fs.mkdir — no manual abort plumbing
    // needed here.
    buffer = await fs.readFile(filePath, { signal: opts.signal });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).name === "AbortError") throw err;
    if (isToolFormattedError(err)) throw err;
    // Use relative path to avoid exposing absolute host path
    const relPath = path.relative(sb.root, filePath);
    const errMsg = describeReadError(err as NodeJS.ErrnoException).replace(filePath, relPath);
    throw toolError("read", `Could not read file "${relPath}": ${errMsg}`, {
      path: target,
      ...(opts.offset !== undefined ? { offset: opts.offset } : {}),
      ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
    });
  }

  const allLines = decodeBuffer(buffer, relPath).split(/\r\n|\n/);
  const totalLines = allLines.length;

  if (offset > totalLines) {
    throw toolError("read", `Offset ${offset} is beyond end of file (${totalLines} line(s) total)`, {
      path: target,
      offset,
      ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
    });
  }

  const startIndex = offset - 1;
  let endIndex = Math.min(startIndex + maxLines, totalLines);

  // Cap by byte size, trimming lines off the end until under the limit (never a partial line).
  // Accumulates per-line byte counts (each line is joined with a 1-byte "\n") instead of
  // re-measuring the whole selection each time, so the cap stays O(n) for large ranges.
  let selected = allLines.slice(startIndex, endIndex);
  if (selected.length > 0 && Number.isFinite(maxBytes)) {
    let bytes = -1; // no separator before the first line
    let lastUnder = 0;
    for (let i = 0; i < selected.length; i++) {
      bytes += Buffer.byteLength(selected[i]!, "utf8") + 1;
      if (bytes > maxBytes) break;
      lastUnder = i + 1;
    }
    selected = selected.slice(0, lastUnder);
  }
  endIndex = startIndex + selected.length;

  return {
    lines: selected.map((text, i) => ({ line: startIndex + i + 1, text })),
    totalLines,
    truncated: endIndex < totalLines,
  };
}

class StreamingBinaryError extends Error {}

/** True when the file at `p` carries a UTF-16 BOM (whole-buffer decode path). */
async function looksUtf16(p: string): Promise<boolean> {
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(p, "r");
  } catch {
    return false; // let the main read path produce the proper error
  }
  try {
    const head = Buffer.alloc(2);
    const { bytesRead } = await handle.read(head, 0, 2, 0);
    return bytesRead === 2 && ((head[0] === 0xff && head[1] === 0xfe) || (head[0] === 0xfe && head[1] === 0xff));
  } catch {
    return false; // e.g. EISDIR — the main read path produces the proper error
  } finally {
    await handle.close();
  }
}

/**
 * Streaming variant of the line extraction: reads 64KB chunks, splits complete lines as it goes,
 * and never holds more than a chunk plus the collected range in memory. Mirrors `decodeBuffer`:
 * a UTF-8 BOM is skipped, any NUL byte means binary (thrown as StreamingBinaryError after the
 * scan, so `totalLines` counting is unaffected), and line splitting matches the whole-file path
 * exactly — a trailing newline produces the same final empty line.
 */
async function readFileStreaming(
  filePath: string,
  relPath: string,
  opts: { offset: number; maxLines: number; maxBytes: number; signal?: AbortSignal },
): Promise<ReadResult> {
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(filePath, "r");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).name === "AbortError") throw err;
    throw toolError("read", `Could not read file "${relPath}": ${describeReadError(err as NodeJS.ErrnoException)}`, { path: relPath });
  }

  const CHUNK = 64 * 1024;
  const chunk = Buffer.alloc(CHUNK);
  const collected: string[] = [];
  let collectedBytes = -1;
  let nextLine = 1; // 1-indexed line number the next emitted line will get
  let carry = "";
  let sawNul = false;
  let done = false;
  let skippedBom = false;

  try {
    try {
      while (!done) {
        opts.signal?.throwIfAborted();
        const { bytesRead } = await handle.read(chunk, 0, CHUNK, null);
        if (bytesRead === 0) break;
        let piece = chunk.subarray(0, bytesRead);
      if (!skippedBom) {
        skippedBom = true;
        if (bytesRead >= 3 && piece[0] === 0xef && piece[1] === 0xbb && piece[2] === 0xbf) piece = piece.subarray(3);
      }
      if (!sawNul && piece.includes(0)) sawNul = true;

      // Decode byte-by-byte-safe: StringDecoder keeps incomplete UTF-8 sequences at chunk
      // boundaries for the next round instead of emitting replacement characters.
      const combined = carry + piece.toString("utf8");
      carry = "";
      const parts = combined.split(/\r\n|\n/);
      carry = parts.pop() ?? "";
      for (const text of parts) {
        if (sawNul) break; // still counting lines below, but collect nothing
        if (nextLine >= opts.offset && collected.length < opts.maxLines) {
          collectedBytes += Buffer.byteLength(text, "utf8") + 1;
          if (collectedBytes <= opts.maxBytes) collected.push(text);
          else done = true;
        }
        nextLine++;
      }
      if (done) break;
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).name === "AbortError") throw err;
      if (err instanceof StreamingBinaryError) throw err;
      throw toolError("read", `Could not read file "${relPath}": ${describeReadError(err as NodeJS.ErrnoException)}`, { path: relPath });
    }
    if (!done) {
      // EOF: the final carried fragment (empty after a trailing newline) is the last line.
      if (sawNul) throw new StreamingBinaryError();
      if (nextLine >= opts.offset && collected.length < opts.maxLines) {
        collectedBytes += Buffer.byteLength(carry, "utf8") + 1;
        if (collectedBytes <= opts.maxBytes) collected.push(carry);
      }
      nextLine++;
    }
  } finally {
    await handle.close();
  }

  if (sawNul) throw new StreamingBinaryError();
  const totalLines = nextLine - 1;
  if (opts.offset > totalLines) {
    throw toolError("read", `Offset ${opts.offset} is beyond end of file (${totalLines} line(s) total)`, {
      path: relPath,
      offset: opts.offset,
    });
  }
  return {
    lines: collected.map((text, i) => ({ line: opts.offset + i, text })),
    totalLines,
    truncated: opts.offset + collected.length - 1 < totalLines,
  };
}

export function registerReadTool(pi: ToolRegistry) {
  pi.registerTool(
    createTool(READ_TOOL_DEFINITION, {
      renderCall: (args, theme) => {
        const flags: string[] = [];
        if (args.peek === false) flags.push("peek=false");
        if (args.visibility !== undefined && args.visibility !== "public") flags.push(args.visibility);
        if (args.includeDocs) flags.push("docs");
        if (args.maxDepth !== undefined) flags.push(`depth ${args.maxDepth}`);
        const range = args.offset !== undefined || args.limit !== undefined
          ? `:${args.offset ?? 1}${args.limit !== undefined ? `-${(args.offset ?? 1) + args.limit - 1}` : "+"}`
          : undefined;
        return renderLine(theme, "read", args.path, flags.length ? ` (${flags.join(", ")})` : undefined, range);
      },
      async execute(params, { signal, cwd }) {
        const sb = sandboxFor(cwd);

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
    })
  );
}

/** Maps the errnos `read` can hit to fixed, host-independent messages. */
function describeReadError(err: NodeJS.ErrnoException): string {
  switch (err.code) {
    case "ENOENT":
      return "file not found";
    case "EISDIR":
      return "is a directory";
    case "EACCES":
      return "permission denied";
    case "EPERM":
      return "operation not permitted";
    default:
      return err.message;
  }
}

/**
 * Helper function to get the file extension from a path.
 */
export function getExtension(p: string): string {
  const lastDotIndex = p.lastIndexOf(".");
  if (lastDotIndex === -1) return "";
  return p.substring(lastDotIndex).toLowerCase();
}
