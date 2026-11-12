import { Type } from "typebox";

export const EDIT_TOOL_DEFINITION = {
  name: "edit",
  label: "Edit",
  description: "Edit a file by replacing text blocks.",
  parameters: Type.Object({
    path: Type.String({ description: "Path to the file to edit (project-relative)." }),
    oldText: Type.String({
        minLength: 1,
        description: "Exact text to replace; plain file text only, no line numbers.",
      }
    ),
    newText:
        Type.String({ description: "Replacement text; plain file text only, no line numbers." }
    ),
    allowMultipleMatches: Type.Optional(
      Type.Boolean({
        description: "Replace every occurrence of oldText instead of requiring a unique match (default false).",
        default: false,
      })
    ),
  }),
};
