import { Type } from "typebox";

export const INSERT_TOOL_DEFINITION = {
  name: "insert",
  label: "Insert",
  description: "Insert text into a file after a given line number, without replacing existing content.",
  promptGuidelines: [
    "line is 1-indexed (same numbering as grep/read); use 0 to insert before the first line. Use edit to replace text instead.",
  ],
  parameters: Type.Object({
    path: Type.String({ description: "Path to the file to edit (project-relative)." }),
    line: Type.Integer({
      description: "Line number to insert after. Use 0 to insert before the first line.",
    }),
    text: Type.String({ description: "Text to insert. May span multiple lines." }),
  }),
};
