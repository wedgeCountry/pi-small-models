import { Type } from "typebox";

export const DOTNET_BUILD_TOOL_DEFINITION = {
  name: "dotnet_build",
  label: "Dotnet Build",
  description: "Build a .NET project or solution using `dotnet build`. Use to compile C#/F#/VB.NET projects.",
  promptSnippet: "dotnet_build: build a .NET project or solution (bash is disabled)",
  promptGuidelines: [
    "Use dotnet_build to compile .NET projects or solutions.",
    "Specify the path to a .csproj, .fsproj, .vbproj, or .sln file to build a specific project.",
    "Omit path to build the default project in the current directory.",
    "Use configuration to switch between Debug (default) and Release builds.",
    "Use dotnet_build instead of a bash `dotnet build` command — bash is disabled in this project.",
  ],
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