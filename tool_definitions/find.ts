import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { resolveSafePath } from "../src/pathSafety.ts";
import { findFiles } from "../src/find.ts";

export function registerFindTool(pi: ExtensionAPI) {
  pi.registerTool({
    name: "find",
    label: "Find",
    description: "Find files and directories by glob pattern within the project.",
    promptSnippet: "find: locate files by name/glob pattern (bash is disabled)",
    promptGuidelines: [
      'Use find to locate files by name or glob pattern, e.g. "**/*.test.ts".',
      "Use find instead of a bash `find`/`ls -R` command — bash is disabled in this project.",
    ],
    parameters: Type.Object({
      pattern: Type.String({ description: 'Glob pattern to match, e.g. "**/*.ts" or "src/**/index.ts"' }),
      path: Type.Optional(
        Type.String({ description: 'Base directory to search from, relative to the project root. Defaults to ".".' })
      ),
      maxResults: Type.Optional(Type.Integer({ description: "Maximum number of results to return.", default: 200 })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const base = resolveSafePath(ctx.cwd, params.path ?? ".");
      const result = await findFiles(base, params.pattern, { maxResults: params.maxResults });

      const text = result.matches.length
        ? result.matches.join("\n") +
          (result.truncated ? `\n… ${result.total - result.matches.length} more result(s) truncated` : "")
        : "No files matched.";

      return {
        content: [{ type: "text", text }],
        details: result,
      };
    },
  });
}
