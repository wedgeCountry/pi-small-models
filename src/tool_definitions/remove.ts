import { Type } from "typebox";

export const REMOVE_TOOL_DEFINITION = {
  name: "remove",
  label: "Remove",
  description: "Delete a file, or a directory and its contents when recursive is set.",
  parameters: Type.Object({
    path: Type.String({ description: "File or directory to remove, relative to the project root." }),
    recursive: Type.Optional(
      Type.Boolean({
        description: "Required to remove a directory. Removes the directory and everything inside it.",
        default: false,
      })
    ),
  }),
};
