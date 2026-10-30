import { Type } from "typebox";
import { INJECTION_GUARD_GUIDELINES } from "./injectionGuard.ts";
import { PEEK_EXTENSIONS } from "../tools/previewManagers/registry.ts";

export const PEEK_TOOL_DEFINITION = {
  name: "peek",
  label: "Peek",
  description: "Show a compact outline of the file.",
  promptGuidelines: INJECTION_GUARD_GUIDELINES,

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
