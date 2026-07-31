import { Type } from "typebox";

export const LIST_TOOL_DEFINITION = {
  name: "list",
  label: "List",
  description: "List files and directories within the project.",
  promptSnippet: "list: list directory contents (bash is disabled)",
  promptGuidelines: [
    "Use list to see the files and subdirectories inside a directory.",
  ],
  parameters: Type.Object({
    path: Type.Optional(
      Type.String({ description: 'Directory to list, relative to the project root. Defaults to ".".' })
    ),
    recursive: Type.Optional(Type.Boolean({ description: "List subdirectories recursively.", default: false })),
    maxDepth: Type.Optional(
      Type.Integer({ description: "Maximum recursion depth when recursive is true.", default: 3 })
    ),
    showHidden: Type.Optional(Type.Boolean({ description: "Include dotfiles and dot-directories.", default: false })),
  }),
};
