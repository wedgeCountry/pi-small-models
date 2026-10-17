import { Type } from "typebox";

export const WRITE_TOOL_DEFINITION = {
  name: "write",
  label: "Write",
  description: "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.",
  parameters: Type.Object({
    path: Type.String({ description: "Path to the file to write, relative to the project root." }),
    content: Type.String({ description: "Content to write to the file." }),
  }),
};
