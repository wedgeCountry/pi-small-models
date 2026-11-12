import { Type } from "typebox";

export const LSTAT_TOOL_DEFINITION = {
  name: "lstat",
  label: "Lstat",
  description: "Filesystem metadata for a path (file, directory, symlink), without following symlinks.",
  parameters: Type.Object({
    path: Type.String({ description: "Path to inspect (project-relative)." }),
  }),
};
