import { Type } from "typebox";

export const UNINSTALL_TOOL_DEFINITION = {
  name: "uninstall",
  label: "Uninstall",
  description:
    "Remove an installed package: npm (npm uninstall, updates package.json and the lockfile), pip " +
    "(pip uninstall from the project's interpreter, and the entry is removed from requirements.txt when present) " +
    "or NuGet (dotnet remove package, updates the .csproj). Only plain package names are accepted.",
  parameters: Type.Object({
    package: Type.String({
      description: 'Installed package name, e.g. "react", "@scope/pkg", "requests" or "Serilog".',
    }),
    language: Type.Optional(
      Type.String({
        description: "Pin the ecosystem: typescript (npm), python (pip) or dotnet (NuGet). Omit to detect from the project (must be unambiguous).",
        enum: ["typescript", "python", "dotnet"],
      })
    ),
    project: Type.Optional(
      Type.String({
        description: "dotnet only: project (.csproj/.fsproj/.vbproj) to remove the package from, relative to the project root. Defaults to the single project in the root.",
      })
    ),
  }),
};
