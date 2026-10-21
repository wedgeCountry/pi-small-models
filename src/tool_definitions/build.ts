import { Type } from "typebox";

export const BUILD_TOOL_DEFINITION = {
  name: "build",
  label: "Build",
  description:
    "Unified build check for multi-language projects. Runs dotnet_build (if a .NET project/solution is present), " +
    "ts_check (if a tsconfig.json is present) and py_import (if any Python files are present), then reports each " +
    "step's result. Returns an error when any step fails. Steps whose language is not present in the project are skipped.",
  parameters: Type.Object({
    path: Type.Optional(
      Type.String({
        description: "Path to build, relative to the project root. Defaults to the current directory.",
      })
    ),
    configuration: Type.Optional(
      Type.String({
        description: "Build configuration for dotnet_build: Debug (default) or Release.",
        enum: ["Debug", "Release"],
      })
    ),
  }),
};
