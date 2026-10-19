import { Type } from "typebox";

export const MKDIR_TOOL_DEFINITION = {
  name: "mkdir",
  label: "Mkdir",
  description: "Create a directory within the project, including any missing parent directories.",
  parameters: Type.Object({
    path: Type.String({ description: "Directory to create, relative to the project root." }),
  }),
};
