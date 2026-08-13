import { Type } from "typebox";

export const EDIT_TOOL_DEFINITION = {
  name: "edit",
  label: "Edit",
  description: "Edit a file by replacing one or more exact, unique blocks of text.",
  promptSnippet: "edit: replace exact text block(s) in a file; use `edits` to batch several changes to one file in a single call",
  promptGuidelines: [
      "For a single change, pass oldText/newText directly: oldText must match exactly one location in the file's current contents.",
      "Do not use several separate edit calls on the same file, since a later oldText planned against the original file may no longer match once an earlier edit has changed the text.",
      "Instead, for multiple changes to the SAME file, pass an `edits` array instead of oldText/newText. " +
      "Keep each oldText as small as possible while still being unique in the file — do not pad it with large unchanged regions.",
      "Never pass both oldText/newText and edits in the same call."
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
    edits: Type.Optional(
      Type.Array(
        Type.Object({
          oldText: Type.String({
            minLength: 1,
            description: "Exact text to replace for this edit. Must match exactly one location in the file at the point this edit is applied, unless allowMultipleMatches is set. Each edit is applied in order against the result of the previous one, and the file is only written if every edit in the array succeeds. ",
          }),
          newText: Type.String({ description: "Text to replace oldText with for this edit." }),
          allowMultipleMatches: Type.Optional(
            Type.Boolean({
              description: "If true, replace every occurrence of this edit's oldText instead of requiring a unique match.",
              default: false,
            })
          ),
        }),
        {
          minItems: 1,
          description: "Apply one or more edits to the same file in one call, in order, atomically — the file is only written if all edits succeed. Use instead of oldText/newText, e.g. when a file needs more than one change.",
        }
      )
    ),
  }),
};
