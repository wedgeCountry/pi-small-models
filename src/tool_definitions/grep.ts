import { Type } from "typebox";

export const GREP_TOOL_DEFINITION = {
  name: "grep",
  label: "Grep",
  description: "Search file contents for a grep pattern within the project.",
  parameters: Type.Object({
    path: Type.Optional(
      Type.String({ description: 'Base directory to search from, relative to the project root. Defaults to ".".' })
    ),
    pattern: Type.Optional(
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
