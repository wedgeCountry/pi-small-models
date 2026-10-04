import { Type } from "typebox";

export const EDIT_TOOL_DEFINITION = {
  name: "edit",
  label: "Edit",
  description: "Edit a file by replacing text blocks.",
  promptGuidelines: [
      "For a single change, pass oldText/newText directly: oldText must match exactly one location in the file's current contents.",
      "When performing several edits, call this tool with the 'edits' parameter, since multiple edits are safer this way.",
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
            description: "Exact text to replace for this edit. Must match exactly one location in the file at the point this edit is applied, unless allowMultipleMatches is set. Each edit is attempted in order against the result of the previous successful edit; if this edit fails to match it is skipped and reported as a failure, but other edits in the array still apply and are saved.",
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
          description: "Apply one or more edits to the same file in one call, in order. As many edits as possible are applied and saved; any edit that fails to match is skipped and reported back with an error instead of failing the whole call. Use instead of oldText/newText, e.g. when a file needs more than one change.",
        }
      )
    ),
  }),
};
