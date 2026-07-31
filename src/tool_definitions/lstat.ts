import { Type } from "typebox";

export const LSTAT_TOOL_DEFINITION = {
  name: "lstat",
  label: "Lstat",
  description: "Get filesystem metadata for a path (file, directory, or symlink) without following symlinks.",
  promptSnippet: "lstat: inspect a path's type, size, and modification time (bash is disabled)",
  promptGuidelines: [
    "Use lstat to check whether a path exists and inspect its type, size, and modification time.",
    "Use lstat instead of a bash `stat`/`ls -la` command — bash is disabled in this project.",
  ],
  parameters: Type.Object({
    path: Type.String({ description: "Path to inspect, relative to the project root." }),
  }),
};
