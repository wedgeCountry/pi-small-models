import { Type } from "typebox";
import { libQueryGuidelines, libQueryParameters } from "./libShared.ts";

export const DOTNET_LIB_TOOL_DEFINITION = {
  name: "dotnet_lib",
  label: "Dotnet Lib",
  description:
    "Show the API of a NuGet package (or framework assembly/namespace such as System.Text.Json) used by a .NET project.",
  promptSnippet: "dotnet_lib: look up the documented API of a NuGet package a .NET project references",
  promptGuidelines: [
    "The project must be restored: if dotnet_lib says project.assets.json is missing, run dotnet_build first. Use dotnet_list to see referenced packages.",
  ],
  parameters: Type.Object({
    ...libQueryParameters({ package: "Newtonsoft.Json", module: "Newtonsoft.Json.Linq", symbol: "JsonConvert.SerializeObject" }),
    project: Type.Optional(
      Type.String({
        description: "Project (.csproj/.fsproj/.vbproj), solution (.sln/.slnx) or directory to resolve the package for, relative to the project root. Defaults to searching the project root.",
      })
    ),
    tfm: Type.Optional(
      Type.String({ description: 'Target framework, e.g. "net8.0". Defaults to the project\'s first target framework.' })
    ),
  }),
};
