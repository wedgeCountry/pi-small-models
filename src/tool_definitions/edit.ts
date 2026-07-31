import { Type } from "typebox";

export const EDIT_TOOL_DEFINITION = {
  name: "edit",
  label: "Edit",
  description: "Edit a file by replacing one exact, unique block of text with another.",
  promptSnippet: "edit: replace one exact text block in a file (single edit per call)",
  promptGuidelines: [
    "Use edit to make a single precise change to a file: oldText must match exactly one location in the file's current contents.",
    "Keep oldText as small as possible while still being unique in the file — do not pad it with large unchanged regions.",
    "To make multiple separate changes to the same file, call edit again for each change, one at a time."
  ],
  parameters: Type.Object({
    path: Type.String({ description: "Path to the file to edit, relative to the project root." }),
    oldText: Type.String({
      description: "Exact text to replace. Must match exactly one location in the file, unless allowMultipleMatches is set.",
    }),
    newText: Type.String({ description: "Text to replace oldText with." }),
    allowMultipleMatches: Type.Optional(
      Type.Boolean({
        description: "If true, replace every occurrence of oldText instead of requiring a unique match.",
        default: false,
      })
    ),
  }),
};
