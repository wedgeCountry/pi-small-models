import { Type } from "typebox";

export const LSTAT_TOOL_DEFINITION = {
  name: "lstat",
  label: "Lstat",
  description: "Get filesystem metadata for a path (file, directory, or symlink) without following symlinks.",
  parameters: Type.Object({
    path: Type.String({ description: "Path to inspect, relative to the project root." }),
  }),
};
