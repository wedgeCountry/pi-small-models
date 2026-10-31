import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { SEARCH_TOOL_DEFINITION } from "../tool_definitions/search.ts";
import { findFiles } from "./find.ts";
import type { ToolRegistry } from "../sandbox/permissionGate.ts";
import { sandboxFor, type Sandbox } from "../sandbox/sandbox.ts";
import { getEffectiveIgnoreGlobs } from "../commands/ignore.ts";
import { renderLine } from "../backend/renderCall.ts";
import { createTool } from "../backend/createTool.ts";

export interface SearchOptions {
  maxResults?: number;
  signal?: AbortSignal;
  ignoreGlobs?: string[];
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
  sb: Sandbox,
  target: string,
  pattern: string,
  opts: SearchOptions = {}
): Promise<SearchResult> {
  return findFiles(sb, target, pattern, {
    maxResults: opts.maxResults,
    signal: opts.signal,
    ignoreGlobs: opts.ignoreGlobs,
  });
}

export function registerSearchTool(pi: ToolRegistry) {
  pi.registerTool(
    createTool(SEARCH_TOOL_DEFINITION, {
      renderCall: (args, theme) =>
        renderLine(theme, "search", args.pattern, ` in ${args.path ?? "."}`, args.maxResults !== undefined ? ` (limit ${args.maxResults})` : undefined),
      async execute(params, { signal, cwd }) {
        const ignoreGlobs = await getEffectiveIgnoreGlobs(cwd, getAgentDir());
        const result = await searchFiles(sandboxFor(cwd), params.path ?? ".", params.pattern, {
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
    })
  );
}
