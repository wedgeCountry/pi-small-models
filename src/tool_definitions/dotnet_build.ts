import { Type } from "typebox";

export const DOTNET_BUILD_TOOL_DEFINITION = {
  name: "dotnet_build",
  label: "Dotnet Build",
  description: "Build a .NET project or solution using `dotnet build`. Use to compile .NET projects.",
  parameters: Type.Object({
    path: Type.Optional(
      Type.String({
        description: "Path to the project (.csproj, .fsproj, .vbproj) or solution (.sln) file to build, relative to the project root. Defaults to the current directory.",
      })
    ),
    configuration: Type.Optional(
      Type.String({
        description: "Build configuration: Debug (default) or Release.",
        enum: ["Debug", "Release"],
      })
    ),
  }),
};