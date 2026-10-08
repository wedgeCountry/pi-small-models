import { Type } from "typebox";

export const EDIT_TOOL_DEFINITION = {
  name: "edit",
  label: "Edit",
  description: "Edit a file by replacing text blocks.",
  promptGuidelines: [
      "OldText must match exactly one location in the file's current contents."
  ],
  parameters: Type.Object({
    path: Type.String({ description: "Path to the file to edit, relative to the project root." }),
    oldText: Type.Optional(
      Type.String({
        minLength: 1,
        description: "Exact text to replace. Must match exactly one location in the file, unless allowMultipleMatches is set. Omit this and newText when using edits instead.",
      })
    ),
    newText: Type.Optional(
      Type.String({ description: "Text to replace oldText with. Required alongside oldText; omit when using edits." })
    ),
    allowMultipleMatches: Type.Optional(
      Type.Boolean({
        description: "If true, replace every occurrence of oldText instead of requiring a unique match. Only applies to the single oldText/newText form.",
        default: false,
      })
    ),
  }),
};
