import { Type } from "typebox";
import { libQueryGuidelines, libQueryParameters } from "./libShared.ts";

export const PY_LIB_TOOL_DEFINITION = {
  name: "py_lib",
  label: "Py Lib",
  description:
    "Show the API of an installed Python package for the project's interpreter: version, submodules, exported names, and exact signatures with docstrings for one symbol. Reads source/stubs only — never imports the package.",
  promptSnippet: "py_lib: look up the real API (signatures + docstrings) of an installed Python package",
  promptGuidelines: [
    ...libQueryGuidelines("py_lib", "Python"),
    'package can be the pip name or the import name ("beautifulsoup4" or "bs4"); standard-library modules like "json" work too.',
    'Use module for submodules, e.g. module="requests.adapters"; a dotted symbol like "requests.adapters.HTTPAdapter" also works.',
    "Use py_list to see which Python packages are installed.",
  ],
  parameters: Type.Object({
    ...libQueryParameters({ package: "requests", module: "requests.adapters", symbol: "Session.get" }),
    includePrivate: Type.Optional(
      Type.Boolean({ description: "Include _private names. Defaults to false.", default: false })
    ),
  }),
};
