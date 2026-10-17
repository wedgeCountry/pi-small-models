import { Type } from "typebox";
import { libQueryGuidelines, libQueryParameters } from "./libShared.ts";

export const PY_LIB_TOOL_DEFINITION = {
  name: "py_lib",
  label: "Py Lib",
  description:
    "Show the API (signatures + docstrings)  of an installed Python package for the project's interpreter.",
  promptGuidelines: [
    "Use py_list to see which Python packages are installed.",
  ],
  parameters: Type.Object({
    ...libQueryParameters({ package: "requests", module: "requests.adapters", symbol: "Session.get" }),
    includePrivate: Type.Optional(
      Type.Boolean({ description: "Include _private names. Defaults to false.", default: false })
    ),
  }),
};
