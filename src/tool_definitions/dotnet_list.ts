import { Type } from "typebox";

export const DOTNET_LIST_TOOL_DEFINITION = {
  name: "dotnet_list",
  label: "Dotnet List",
  description: "List NuGet package references for a .NET project or solution using `dotnet package list`. Use to check installed packages, verify versions, or find outdated/vulnerable dependencies.",
  promptSnippet: "dotnet_list: list NuGet packages for a .NET project (bash is disabled)",
  promptGuidelines: [
    "Use dotnet_list to see what NuGet packages are referenced in a .NET project or solution.",
    "Use dotnet_list to verify package versions or check for outdated/vulnerable packages.",
    "Use dotnet_list to debug 'package not found' or version conflict errors.",
    "Specify a project (.csproj, .fsproj, .vbproj) or solution (.sln) file to list packages for a specific project.",
    "Omit path to list packages for the project in the current directory.",
    "Use --outdated to find newer versions of packages.",
    "Use --include-transitive to show transitive dependencies.",
    "Use dotnet_list instead of a bash `dotnet package list` command — bash is disabled in this project.",
  ],
  parameters: Type.Object({
    path: Type.Optional(
      Type.String({
        description: "Path to the project (.csproj, .fsproj, .vbproj) or solution (.sln) file to list packages for, relative to the project root. Defaults to the current directory.",
      })
    ),
    outdated: Type.Optional(
      Type.Boolean({
        description: "Show available updates for packages. Defaults to false.",
        default: false,
      })
    ),
    includeTransitive: Type.Optional(
      Type.Boolean({
        description: "Include transitive dependencies (packages referenced by your direct dependencies). Defaults to false.",
        default: false,
      })
    ),
    includePrerelease: Type.Optional(
      Type.Boolean({
        description: "Include prerelease versions when checking for updates (only applies with --outdated). Defaults to false.",
        default: false,
      })
    ),
    deprecated: Type.Optional(
      Type.Boolean({
        description: "Show packages that have been deprecated. Defaults to false.",
        default: false,
      })
    ),
    vulnerable: Type.Optional(
      Type.Boolean({
        description: "Show packages that have known vulnerabilities. Defaults to false.",
        default: false,
      })
    ),
    noRestore: Type.Optional(
      Type.Boolean({
        description: "Skip automatic restore before listing packages. Defaults to false.",
        default: false,
      })
    ),
  }),
};