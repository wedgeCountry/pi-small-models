import { Type } from "typebox";
import { INJECTION_GUARD_GUIDELINES } from "./injectionGuard.ts";

export const LSTAT_TOOL_DEFINITION = {
  name: "lstat",
  label: "Lstat",
  description: "Get filesystem metadata for a path (file, directory, or symlink) without following symlinks.",
  promptGuidelines: INJECTION_GUARD_GUIDELINES,

  parameters: Type.Object({
    path: Type.String({ description: "Path to inspect, relative to the project root." }),
  }),
};
