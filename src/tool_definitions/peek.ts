import { Type } from "typebox";
import { PEEK_EXTENSIONS } from "../tools/previewManagers/registry.ts";

export const PEEK_TOOL_DEFINITION = {
  name: "peek",
  label: "Peek",
  description: "Show a compact outline of the file.",
  promptSnippet: "peek: outline a code file (signatures, no bodies) or a Markdown file (headings only)",
  promptGuidelines: [
    "Use peek to get an overview of a file before reading it; then use read with offset/limit on the line numbers peek reports to see a specific body.",
    "Supported extensions: " + PEEK_EXTENSIONS.join(", ") + ". Use read for any other file,"
  ],
  parameters: Type.Object({
    path: Type.String({ description: "File to outline, relative to the project root." }),
    visibility: Type.Optional(
      Type.Union([Type.Literal("public"), Type.Literal("protected"), Type.Literal("private")], {
        description:
          'Most-private declarations to include (inclusive): "public" (default) shows only public API, ' +
          '"protected" adds protected members, "private" shows everything. Ignored for Markdown.',
        default: "public",
      })
    ),
    includeDocs: Type.Optional(
      Type.Boolean({
        description: "Include full docstrings / JSDoc / XML doc comments. Defaults to false. Ignored for Markdown.",
        default: false,
      })
    ),
    maxDepth: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: 6,
        description: "Markdown only: deepest heading level to show (1 = only # headings). Defaults to 6 (all).",
      })
    ),
  }),
};
