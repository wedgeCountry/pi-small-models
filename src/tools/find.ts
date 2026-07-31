import fg from "fast-glob";
import {DEFAULT_IGNORE_GLOBS} from "../ignore.ts";
import type {ExtensionAPI} from "@earendil-works/pi-coding-agent";
import {FIND_TOOL_DEFINITION} from "../tool_definitions/find.ts";
import {resolveSafePath} from "../pathSafety.ts";

export interface FindOptions {
  maxResults?: number;
}

export interface FindResult {
  matches: string[];
  total: number;
  truncated: boolean;
}

/** Finds files/directories under `base` matching a glob pattern. */
export async function findFiles(base: string, pattern: string, opts: FindOptions = {}): Promise<FindResult> {
  const max = opts.maxResults ?? 200;
  const matches = await fg(pattern, {
    cwd: base,
    ignore: DEFAULT_IGNORE_GLOBS,
    onlyFiles: false,
    dot: false,
    followSymbolicLinks: false,
  });
  matches.sort();
  const truncated = matches.length > max;
  return { matches: matches.slice(0, max), total: matches.length, truncated };
}

export function registerFindTool(pi: ExtensionAPI) {
  pi.registerTool({
    ...FIND_TOOL_DEFINITION,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const base = resolveSafePath(ctx.cwd, params.path ?? ".");
      const result = await findFiles(base, params.pattern, {maxResults: params.maxResults});

      const text = result.matches.length
          ? result.matches.join("\n") +
          (result.truncated ? `\n… ${result.total - result.matches.length} more result(s) truncated` : "")
          : "No files matched.";

      return {
        content: [{type: "text", text}],
        details: result,
      };
    },
  });
}