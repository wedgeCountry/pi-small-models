import * as path from "node:path";
import { PEEK_TOOL_DEFINITION } from "../tool_definitions/peek.ts";
import { readFile } from "./read.ts";
import type { ToolRegistry } from "../sandbox/permissionGate.ts";
import { sandboxFor, type Sandbox } from "../sandbox/sandbox.ts";
import { oneLine, callName } from "../renderCall.ts";
import { withConciseValidationErrors } from "../toolValidation.ts";
import { PEEK_EXTENSIONS, previewManagerFor } from "./previewManagers/registry.ts";
import type { PeekLine, PeekVisibility } from "./previewManagers/types.ts";

/** Same caps as `read`, so one peek can't flood a small model's context either. */
const DEFAULT_MAX_LINES = 2000;
const DEFAULT_MAX_BYTES = 50 * 1024; // 50KB

export interface PeekOptions {
  visibility?: PeekVisibility;
  includeDocs?: boolean;
  maxDepth?: number;
  signal?: AbortSignal;
}

export interface PeekResult {
  /** Which PreviewManager handled the file, e.g. `"python"`. */
  language: string;
  lines: PeekLine[];
  /** Line count of the whole file. */
  totalLines: number;
  /** True when the outline itself hit the line/byte cap. */
  truncated: boolean;
}

/**
 * Builds a structural outline of the file at `target` (resolved through `sb`) with the
 * PreviewManager registered for its extension (see src/tools/previewManagers/).
 *
 * The file is read exclusively through `read`'s `readFile`, so peek
 * gets exactly the same root containment, symlink-escape and restricted-glob checks (and the same
 * line splitting/numbering) as `read` — it never touches the filesystem itself. Throws for an
 * unsupported extension, a sandbox violation, a directory, or a binary file. Output lines keep
 * the file's 1-indexed line numbers, so they chain into `read`'s `offset`/`limit`.
 */
export async function peekFile(sb: Sandbox, target: string, opts: PeekOptions = {}): Promise<PeekResult> {
  const ext = path.extname(target);
  const manager = previewManagerFor(ext);
  if (!manager) {
    throw new Error(
      `peek does not support "${ext || path.basename(target)}" files. Supported extensions: ` +
        `${PEEK_EXTENSIONS.join(", ")}. Use read to view this file instead.`
    );
  }

  const maxDepth = opts.maxDepth ?? 6;
  if (!Number.isInteger(maxDepth) || maxDepth < 1 || maxDepth > 6) {
    throw new Error(`maxDepth must be an integer from 1 to 6, got ${opts.maxDepth}`);
  }

  // `uncapped`: peek has to see the whole file to outline it; its own output is capped below.
  const read = await readFile(sb, target, { uncapped: true, signal: opts.signal });
  const allLines = read.lines.map((l) => l.text);
  if (allLines.some((l) => l.includes("\0"))) throw new Error(`Could not peek "${target}": it looks like a binary file.`);
  opts.signal?.throwIfAborted();
  let lines = manager.preview(allLines, {
    visibility: opts.visibility ?? "public",
    includeDocs: opts.includeDocs ?? false,
    maxDepth,
  });

  let truncated = false;
  if (lines.length > DEFAULT_MAX_LINES) {
    lines = lines.slice(0, DEFAULT_MAX_LINES);
    truncated = true;
  }
  let bytes = 0;
  for (let k = 0; k < lines.length; k++) {
    bytes += Buffer.byteLength(lines[k]!.text, "utf8") + 1;
    if (bytes > DEFAULT_MAX_BYTES && k > 0) {
      lines = lines.slice(0, k);
      truncated = true;
      break;
    }
  }

  return { language: manager.language, lines, totalLines: read.totalLines, truncated };
}

/** Renders a result the way the model sees it (`line:text`, like read). */
export function renderPeekResult(displayPath: string, result: PeekResult, visibility: PeekVisibility): string {
  if (result.lines.length === 0) {
    const hint =
      result.language === "markdown"
        ? "No headings found."
        : visibility === "private"
          ? "No declarations found."
          : `No ${visibility} declarations found (try visibility: "private" to include everything).`;
    return `${displayPath} (${result.language}, ${result.totalLines} lines): ${hint}`;
  }
  let text = result.lines.map((l) => `${l.line}:${l.text}`).join("\n");
  if (result.truncated) {
    const last = result.lines[result.lines.length - 1]!.line;
    text += `\n\n[Outline truncated after line ${last} of ${result.totalLines}. Use read with offset=${last + 1} to see the rest.]`;
  }
  return text;
}

export function registerPeekTool(pi: ToolRegistry) {
  pi.registerTool({
    ...PEEK_TOOL_DEFINITION,
    prepareArguments: withConciseValidationErrors(PEEK_TOOL_DEFINITION.name, PEEK_TOOL_DEFINITION.parameters),
    renderCall(args, theme) {
      let text = `${callName(theme, "peek")} ${theme.fg("accent", args.path ?? "")}`;
      const flags: string[] = [];
      if (args.visibility && args.visibility !== "public") flags.push(args.visibility);
      if (args.includeDocs) flags.push("docs");
      if (args.maxDepth !== undefined) flags.push(`depth ${args.maxDepth}`);
      if (flags.length) text += theme.fg("toolOutput", ` (${flags.join(", ")})`);
      return oneLine(text);
    },
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const visibility = (params.visibility ?? "public") as PeekVisibility;
      const result = await peekFile(sandboxFor(ctx.cwd), params.path, {
        visibility,
        includeDocs: params.includeDocs,
        maxDepth: params.maxDepth,
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
    },
  });
}
