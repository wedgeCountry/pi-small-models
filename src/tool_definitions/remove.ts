import { Type } from "typebox";

export const REMOVE_TOOL_DEFINITION = {
  name: "remove",
  label: "Remove",
  description: "Delete a file, or a directory and its contents when recursive is set.",
  promptSnippet: "remove: delete a file or directory (bash is disabled)",
  promptGuidelines: [
    "Use remove to delete a file, or a directory when recursive is set to true.",
    "Set recursive to true only when you intend to delete a directory and everything inside it — this cannot be undone.",
    "Use remove instead of a bash `rm` command — bash is disabled in this project.",
  ],
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
