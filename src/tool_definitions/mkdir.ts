import { Type } from "typebox";
import { INJECTION_GUARD_GUIDELINES } from "./injectionGuard.ts";

export const MKDIR_TOOL_DEFINITION = {
  name: "mkdir",
  label: "Mkdir",
  description: "Create a directory within the project, including any missing parent directories.",
  promptGuidelines: INJECTION_GUARD_GUIDELINES,

  parameters: Type.Object({
    path: Type.String({ description: "Directory to create, relative to the project root." }),
  }),
};
