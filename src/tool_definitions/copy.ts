import { Type } from "typebox";

export const COPY_TOOL_DEFINITION = {
  name: "copy",
  label: "Copy",
  description: "Copy a file or directory to a new path within the project, leaving the original in place.",
  promptSnippet: "copy: copy a file or directory to a new path (bash is disabled)",
  promptGuidelines: [
    "Use copy to duplicate a file or directory; the original at path is left untouched.",
    "Set recursive to true only when copying a directory — copying a single file never needs it.",
    "Set overwrite to true to replace an existing file or directory at destination; otherwise copy fails if destination already exists.",
    "Use copy instead of a bash `cp` command — bash is disabled in this project.",
  ],
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
