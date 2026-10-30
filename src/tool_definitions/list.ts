import { Type } from "typebox";
import { INJECTION_GUARD_GUIDELINES } from "./injectionGuard.ts";

export const LIST_TOOL_DEFINITION = {
  name: "list",
  label: "List",
  description: "List files and directories within the project.",
  promptGuidelines: INJECTION_GUARD_GUIDELINES,

  parameters: Type.Object({
    path: Type.Optional(
      Type.String({ description: 'Directory to list, relative to the project root. Defaults to ".".' })
    ),
    recursive: Type.Optional(Type.Boolean({ description: "List subdirectories recursively.", default: false })),
    maxDepth: Type.Optional(
      Type.Integer({ description: "Maximum recursion depth when recursive is true.", default: 3 })
    ),
    showHidden: Type.Optional(Type.Boolean({ description: "Include dotfiles and dot-directories.", default: false })),
    maxResults: Type.Optional(Type.Integer({ description: "Maximum number of entries to return.", default: 200 })),
  }),
};
