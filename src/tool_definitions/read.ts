import { Type } from "typebox";
import { INJECTION_GUARD_GUIDELINES } from "./injectionGuard.ts";

export const READ_TOOL_DEFINITION = {
  name: "read",
  label: "Read",
  description:
    "Read a text file. Defaults to peek=true: shows a compact outline of the file's structure " +
    "(declarations with line numbers). Pass peek=false, or an offset/limit, to read raw contents " +
    "numbered by line.",
  promptGuidelines: INJECTION_GUARD_GUIDELINES,

  parameters: Type.Object({
    path: Type.String({ description: "Path to the file to read, relative to the project root." }),
    offset: Type.Optional(
      Type.Integer({ minimum: 1, description: "1-indexed line number to start reading from. Defaults to 1." })
    ),
    limit: Type.Optional(Type.Integer({ minimum: 1, description: "Maximum number of lines to read." })),
    peek: Type.Optional(
      Type.Boolean({
        description: "If true, show a compact outline of the file instead of its contents. Defaults to true.",
        default: true,
      })
    ),
    visibility: Type.Optional(
      Type.Union([Type.Literal("public"), Type.Literal("protected"), Type.Literal("private")], {
        description:
          'Outline only: most-private declarations to include (inclusive): "public" (default) shows only public API, ' +
          '"protected" adds protected members, "private" shows everything. Ignored for Markdown.',
        default: "public",
      })
    ),
    includeDocs: Type.Optional(
      Type.Boolean({
        description: "Outline only: include full docstrings / JSDoc / XML doc comments. Defaults to false.",
        default: false,
      })
    ),
    maxDepth: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: 6,
        description: "Outline only: max nesting depth (Markdown: deepest heading level). Defaults to 6 (all).",
      })
    ),
  }),
};
