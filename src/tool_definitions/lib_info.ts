import { Type } from "typebox";
import { libQueryParameters } from "./libShared.ts";

export const LIB_INFO_TOOL_DEFINITION = {
  name: "lib_info",
  label: "Library Info",
  description:
    "Show the API (signatures + docs) of an installed package, unifying ts_lib, py_lib and dotnet_lib. " +
    "Detects the language automatically by trying TypeScript (npm), then Python, then .NET; pass language to pin one. " +
    "Same views as the underlying tools: overview by default, symbol= for one symbol, query= to search names.",
  promptGuidelines: [
    "Use lib_info to look up the real API of an installed package in any language instead of guessing from memory.",
  ],
  parameters: Type.Object({
    ...libQueryParameters({ package: "react", module: "react-dom/client", symbol: "useState" }),
    language: Type.Optional(
      Type.String({
        description: "Pin the language: typescript (npm), python or dotnet (NuGet). Omit to auto-detect.",
        enum: ["typescript", "python", "dotnet"],
      })
    ),
  }),
};
