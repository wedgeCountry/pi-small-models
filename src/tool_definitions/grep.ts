import { Type } from "typebox";
import { INJECTION_GUARD_GUIDELINES } from "./injectionGuard.ts";

export const GREP_TOOL_DEFINITION = {
  name: "grep",
  label: "Grep",
  description: "Search file contents for a regex within the project.",
  promptGuidelines: INJECTION_GUARD_GUIDELINES,

  parameters: Type.Object({
    regex: Type.String({
      description: "Regex to search for within file contents, e.g. \"foo\\s*=\\s*\\d+\"."
    }),
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
