import { Type } from "typebox";

export const INSTALL_TOOL_DEFINITION = {
  name: "install",
  label: "Install",
  description:
    "Install an officially registered package: npm (registry.npmjs.org), pip (PyPI) or NuGet (api.nuget.org). " +
    "The package name is validated against the registry's grammar and the package's existence is confirmed via the " +
    "registry's HTTP API before anything is installed — local files (wheels, tarballs, .nupkg), paths, and git URLs " +
    "are always rejected. npm installs run with --ignore-scripts; packages needing native compilation must be " +
    "rebuilt manually (the output explains how).",
  parameters: Type.Object({
    package: Type.String({
      description: 'Official registry package name, e.g. "react", "@scope/pkg", "requests" or "Serilog". Version goes in the version parameter.',
    }),
    version: Type.Optional(
      Type.String({
        description: 'Version to install. npm accepts ranges like "^2.0.0"; pip and NuGet install this exact version. Omit for the latest version.',
      })
    ),
    language: Type.Optional(
      Type.String({
        description: "Pin the ecosystem: typescript (npm), python (pip) or dotnet (NuGet). Omit to detect from the project (must be unambiguous).",
        enum: ["typescript", "python", "dotnet"],
      })
    ),
    dev: Type.Optional(
      Type.Boolean({
        description: "npm only: install as a devDependency. Defaults to false.",
        default: false,
      })
    ),
    project: Type.Optional(
      Type.String({
        description: "dotnet only: project (.csproj/.fsproj/.vbproj) to add the package to, relative to the project root. Defaults to the single project in the root.",
      })
    ),
  }),
};
