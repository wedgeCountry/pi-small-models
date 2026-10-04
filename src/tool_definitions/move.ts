import { Type } from "typebox";

export const MOVE_TOOL_DEFINITION = {
  name: "move",
  label: "Move",
  description: "Move or rename a file or directory to a new path within the project.",
  promptSnippet: "move: move or rename a file or directory (bash is disabled)",
  promptGuidelines: [
    "Use move to relocate a file or directory, or to rename it in place by giving it a new destination in the same directory.",
    "Set recursive to true only when moving a directory — moving a single file never needs it.",
    "Set overwrite to true to replace an existing file or directory at destination; otherwise move fails if destination already exists.",
    "Use move instead of a bash `mv` command — bash is disabled in this project.",
  ],
  parameters: Type.Object({
    path: Type.String({ description: "File or directory to move, relative to the project root." }),
    destination: Type.String({ description: "Path to move to, relative to the project root." }),
    recursive: Type.Optional(
      Type.Boolean({
        description: "Required to move a directory. Moves the directory and everything inside it.",
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
