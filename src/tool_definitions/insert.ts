import { Type } from "typebox";

export const INSERT_TOOL_DEFINITION = {
  name: "insert",
  label: "Insert",
  description: "Insert text into a file after a given line number, without replacing existing content.",
  promptSnippet: "insert: insert text after a given line in a file",
  promptGuidelines: [
    "Use insert to add new text into a file after a specific line, without replacing existing content.",
    "line is 1-indexed, matching the line numbers grep reports. Use line: 0 to insert before the first line.",
    "Use edit instead of insert when replacing existing text rather than adding new text.",
  ],
  parameters: Type.Object({
    path: Type.String({ description: "Path to the file to edit, relative to the project root." }),
    line: Type.Integer({
      description: "Line number to insert after. Use 0 to insert before the first line.",
    }),
    text: Type.String({ description: "Text to insert. May span multiple lines." }),
  }),
};
