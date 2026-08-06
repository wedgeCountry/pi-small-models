import { Type } from "typebox";

export const WRITE_TOOL_DEFINITION = {
  name: "write",
  label: "Write",
  description: "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.",
  promptSnippet: "write: create a new file or overwrite an existing one with the given content",
  promptGuidelines: [
    "Use write only for new files or complete rewrites of a file's contents.",
    "Use edit instead of write when changing part of an existing file, so unrelated content isn't lost.",
  ],
  parameters: Type.Object({
    path: Type.String({ description: "Path to the file to write, relative to the project root." }),
    content: Type.String({ description: "Content to write to the file." }),
  }),
};
