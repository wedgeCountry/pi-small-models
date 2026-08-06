import { Type } from "typebox";

export const GREP_TOOL_DEFINITION = {
  name: "grep",
  label: "Grep",
  description: "Search file contents for a regex or plain-text pattern within the project.",
  promptSnippet: "grep: search file contents by regex/text (bash is disabled)",
  promptGuidelines: [
    "Use grep to search file contents for a regular expression (JS syntax) or plain text.",
    "If you have identified interesting lines and want to use read, use the offset and limit parameters.",
  ],
  parameters: Type.Object({
    pattern: Type.String({ description: "Regular expression (JS syntax) or plain text to search for." }),
    // "path" must name a directory (it's used as fast-glob's `cwd`), not the
    // file to search — that's what "glob" is for. Passing a specific file
    // here (e.g. path: "main.py") fails once grepFiles() tries to stat it:
    // grep pattern:"\)\)" path:"main.py"        -> Error: grep path "…/main.py" is a file, not a directory.
    // grep pattern:"\)\)" glob:"main.py"        -> searches only main.py, from the project root
    // grep pattern:"\)\)" path:"src" glob:"main.py" -> searches only src/main.py
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
