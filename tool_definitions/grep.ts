import { Type } from "typebox";

export const GREP_TOOL_DEFINITION = {
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
};
