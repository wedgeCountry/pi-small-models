import { Type } from "typebox";

export const MOVE_TOOL_DEFINITION = {
  name: "move",
  label: "Move",
  description: "Move or rename a file or directory to a new path within the project.",
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
