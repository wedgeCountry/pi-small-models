import { Type } from "typebox";

export const READ_TOOL_DEFINITION = {
  name: "read",
  label: "Read",
  description:
    "Read a text file. Use peek=true (default) for a compact structural outline with line numbers. ",
  parameters: Type.Object({
    path: Type.String({ description: "Path to the file to read, relative to the project root." }),
    offset: Type.Optional(
      Type.Integer({ minimum: 1, description: "1-indexed line number to start reading from. Defaults to 1." })
    ),
    limit: Type.Optional(Type.Integer({ minimum: 1, description: "Maximum number of lines to read." })),
    peek: Type.Optional(
      Type.Boolean({
        description: "If true, show a compact outline of the file. Usually sufficient in most cases.",
        default: true,
      })
    ),
    visibility: Type.Optional(
      Type.Union([Type.Literal("public"), Type.Literal("protected"), Type.Literal("private")], {
        description:
          'Outline only: "public" (default) shows only public API, "protected" adds protected members, "private" shows everything.',
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
