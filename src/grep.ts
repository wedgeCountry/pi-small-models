import fg from "fast-glob";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { DEFAULT_IGNORE_GLOBS } from "./ignore.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { GREP_TOOL_DEFINITION } from "../tool_definitions/grep.ts";
import { resolveSafePath } from "./pathSafety.ts";

export interface GrepOptions {
  glob?: string;
  ignoreCase?: boolean;
  maxResults?: number;
  contextLines?: number;
  signal?: AbortSignal;
}

export interface GrepLine {
  file: string;
  line: number;
  text: string;
  isMatch: boolean;
}

export interface GrepResult {
  lines: GrepLine[];
  matchCount: number;
  filesScanned: number;
  truncated: boolean;
}

/** Searches file contents under `base` for a regex/plain-text pattern. */
export async function grepFiles(base: string, pattern: string, opts: GrepOptions = {}): Promise<GrepResult> {
  const max = opts.maxResults ?? 200;
  const context = opts.contextLines ?? 0;

  let regex: RegExp;
  try {
    regex = new RegExp(pattern, opts.ignoreCase ? "i" : "");
  } catch (err) {
    throw new Error(`Invalid pattern: ${(err as Error).message}`);
  }

  const files = await fg(opts.glob ?? "**/*", {
    cwd: base,
    ignore: DEFAULT_IGNORE_GLOBS,
    onlyFiles: true,
    dot: false,
    followSymbolicLinks: false,
  });
  files.sort();

  const lines: GrepLine[] = [];
  let matchCount = 0;
  let filesScanned = 0;

  for (const relFile of files) {
    if (opts.signal?.aborted) throw new Error("Aborted");
    if (matchCount >= max) break;

    let content: string;
    try {
      content = await fs.readFile(path.join(base, relFile), "utf8");
    } catch {
      continue; // unreadable or not text
    }
    if (content.includes("\0")) continue; // skip binary files

    filesScanned++;
    const fileLines = content.split("\n");
    for (let i = 0; i < fileLines.length && matchCount < max; i++) {
      if (!regex.test(fileLines[i] ?? "")) continue;
      matchCount++;
      const from = Math.max(0, i - context);
      const to = Math.min(fileLines.length - 1, i + context);
      for (let j = from; j <= to; j++) {
        lines.push({ file: relFile, line: j + 1, text: fileLines[j] ?? "", isMatch: j === i });
      }
    }
  }

  return { lines, matchCount, filesScanned, truncated: matchCount >= max };
}

export function registerGrepTool(pi: ExtensionAPI) {
  pi.registerTool({
    ...GREP_TOOL_DEFINITION,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const base = resolveSafePath(ctx.cwd, params.path ?? ".");
      const result = await grepFiles(base, params.pattern, {
        glob: params.glob,
        ignoreCase: params.ignoreCase,
        maxResults: params.maxResults,
        contextLines: params.contextLines,
        signal,
      });

      const text = result.lines.length
        ? result.lines.map((l) => `${l.file}${l.isMatch ? ":" : "-"}${l.line}${l.isMatch ? ":" : "-"}${l.text}`).join("\n") +
          (result.truncated ? `\n… results truncated at ${params.maxResults ?? 200} matches` : "")
        : "No matches found.";

      return {
        content: [{ type: "text", text }],
        details: { matchCount: result.matchCount, filesScanned: result.filesScanned, truncated: result.truncated },
      };
    },
  });
}
