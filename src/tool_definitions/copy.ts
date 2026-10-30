import { Type } from "typebox";
import { INJECTION_GUARD_GUIDELINES } from "./injectionGuard.ts";

export const COPY_TOOL_DEFINITION = {
  name: "copy",
  label: "Copy",
  description: "Copy a file or directory to a new path within the project, leaving the original in place.",
  promptGuidelines: INJECTION_GUARD_GUIDELINES,
  parameters: Type.Object({
    path: Type.String({ description: "File or directory to copy, relative to the project root." }),
    destination: Type.String({ description: "Path to copy to, relative to the project root." }),
    recursive: Type.Optional(
      Type.Boolean({
        description: "Required to copy a directory. Copies the directory and everything inside it.",
        default: false,
      })
    ),
    overwrite: Type.Optional(
      Type.Boolean({
        description: "Required to replace an existing file or directory at destination.",
        default: false,
      })
    ),
  }),
};
