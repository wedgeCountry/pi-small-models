import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { resolveSafePath } from "../src/pathSafety.ts";
import { grepFiles } from "../src/grep.ts";

export function registerGrepTool(pi: ExtensionAPI) {
  pi.registerTool({
    name: "grep",
    label: "Grep",
    description: "Search file contents for a regex or plain-text pattern within the project.",
    promptSnippet: "grep: search file contents by regex/text (bash is disabled)",
    promptGuidelines: [
      "Use grep to search file contents for a regular expression (JS syntax) or plain text.",
      "Use grep instead of a bash `grep`/`rg`/`findstr` command — bash is disabled in this project.",
    ],
    parameters: Type.Object({
      pattern: Type.String({ description: "Regular expression (JS syntax) or plain text to search for." }),
      path: Type.Optional(
        Type.String({ description: 'Base directory to search from, relative to the project root. Defaults to ".".' })
      ),
      glob: Type.Optional(
        Type.String({ description: 'Glob to restrict which files are searched, e.g. "**/*.ts". Defaults to all files.' })
      ),
      ignoreCase: Type.Optional(Type.Boolean({ description: "Case-insensitive match.", default: false })),
      maxResults: Type.Optional(
        Type.Integer({ description: "Maximum number of matching lines to return.", default: 200 })
      ),
      contextLines: Type.Optional(
        Type.Integer({ description: "Lines of context to include before/after each match.", default: 0 })
      ),
    }),
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
