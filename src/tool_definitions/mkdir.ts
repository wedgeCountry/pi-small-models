import { Type } from "typebox";

export const MKDIR_TOOL_DEFINITION = {
  name: "mkdir",
  label: "Mkdir",
  description: "Create a directory within the project, including any missing parent directories.",
  promptSnippet: "mkdir: create a directory, including missing parents (bash is disabled)",
  promptGuidelines: [
    "Use mkdir to create a new directory. Missing parent directories are created automatically.",
    "Use mkdir instead of a bash `mkdir` command — bash is disabled in this project.",
  ],
  parameters: Type.Object({
    path: Type.String({ description: "Directory to create, relative to the project root." }),
  }),
};
