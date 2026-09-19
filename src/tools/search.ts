import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { SEARCH_TOOL_DEFINITION } from "../tool_definitions/search.ts";
import { findFiles } from "./find.ts";
import { resolveSandboxPath } from "../sandbox.ts";
import { getEffectiveIgnoreGlobs } from "../ignore.ts";
import { oneLine, callName } from "../renderCall.ts";

export interface SearchOptions {
  maxResults?: number;
  signal?: AbortSignal;
}

export interface SearchResult {
  matches: string[];
  total: number;
  truncated: boolean;
}

/**
 * Search for files/directories matching a pattern.
 * Wrapper around findFiles with simpler defaults.
 */
export async function searchFiles(
  base: string,
  pattern: string,
  opts: SearchOptions = {}
): Promise<SearchResult> {
  return findFiles(base, pattern, {
    maxResults: opts.maxResults,
    signal: opts.signal,
  });
}

export function registerSearchTool(pi: ExtensionAPI) {
  pi.registerTool({
    ...SEARCH_TOOL_DEFINITION,
    renderCall(args, theme) {
      let text = `${callName(theme, "search")} ${theme.fg("accent", args.pattern ?? "")}`;
      text += theme.fg("toolOutput", ` in ${args.path ?? "."}`);
      if (args.maxResults !== undefined)
        text += theme.fg("toolOutput", ` (limit ${args.maxResults})`);
      return oneLine(text);
    },
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const base = resolveSandboxPath(ctx.cwd, params.path ?? ".", "read");
      const ignoreGlobs = await getEffectiveIgnoreGlobs(ctx.cwd, getAgentDir());
      const result = await searchFiles(base, params.pattern, {
        maxResults: params.maxResults,
        signal,
        ignoreGlobs,
      });

      const text = result.matches.length
        ? result.matches.join("\n") +
          (result.truncated
            ? `\n… ${result.total - result.matches.length} more result(s) truncated`
            : "")
        : "No files matched.";

      return {
        content: [{ type: "text", text }],
        details: result,
      };
    },
  });
}