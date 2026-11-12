import { Type } from "typebox";
import { uncappedParam } from "../backend/capOutput.ts";
import { PEEK_EXTENSIONS } from "../tools/previewManagers/registry.ts";

export const PEEK_TOOL_DEFINITION = {
  name: "peek",
  label: "Peek",
  description: "Show a compact outline of the file.",
  parameters: Type.Object({
    path: Type.String({ description: "File to outline (project-relative)." }),
    visibility: Type.Optional(
      Type.Union([Type.Literal("public"), Type.Literal("protected"), Type.Literal("private")], {
        description:
          'Declarations to include: "public" (default), "protected" or "private" (everything). Ignored for Markdown.',
        default: "public",
      })
    ),
    includeDocs: Type.Optional(
      Type.Boolean({
        description: "Include full docstrings/JSDoc/XML docs (default false). Ignored for Markdown.",
        default: false,
      })
    ),
    maxDepth: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: 6,
        description: "Markdown only: deepest heading level to show (default 6 = all).",
      })
    ),
    uncapped: uncappedParam,
  }),
};
