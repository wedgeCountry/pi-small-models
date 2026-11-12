import { Type } from "typebox";

export const WRITE_TOOL_DEFINITION = {
  name: "write",
  label: "Write",
  description: "Write content to a file, creating or overwriting it (parent directories are created automatically).",
  parameters: Type.Object({
    path: Type.String({ description: "Path to the file to write (project-relative)." }),
    content: Type.String({ description: "Content to write to the file." }),
  }),
};
