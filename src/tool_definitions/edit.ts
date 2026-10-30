import { Type } from "typebox";
import { INJECTION_GUARD_GUIDELINES } from "./injectionGuard.ts";

export const EDIT_TOOL_DEFINITION = {
  name: "edit",
  label: "Edit",
  description: "Edit a file by replacing text blocks.",
  promptGuidelines: INJECTION_GUARD_GUIDELINES,

  parameters: Type.Object({
    path: Type.String({ description: "Path to the file to edit, relative to the project root." }),
    oldText: Type.String({
        minLength: 1,
        description: "Exact text to replace. Must match exactly the content in the file. You must not include line numbers, but only the plain text!",
      }
    ),
    newText:
        Type.String({ description: "Text to replace oldText with. You must not include line numbers, but only the plain text!" }
    ),
    allowMultipleMatches: Type.Optional(
      Type.Boolean({
        description: "If true, replace every occurrence of oldText instead of requiring a unique match. Only applies to the single oldText/newText form.",
        default: false,
      })
    ),
  }),
};
