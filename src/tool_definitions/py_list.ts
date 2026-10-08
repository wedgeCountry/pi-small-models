import { Type } from "typebox";

export const PY_LIST_TOOL_DEFINITION = {
  name: "py_list",
  label: "Py List",
  description:
    "List the Python packages installed for the project's interpreter (project .venv if present), like `pip list`. With an exact package name, show its version, summary, import name, requirements and reverse dependencies.",
  promptSnippet: "py_list: list installed Python packages and versions (bash is disabled)",
  promptGuidelines: [
    "Use py_list to check whether a Python package is installed and which version.",
    "Use py_list package=\"name\" for one package's details (import name, requires, required by).",
    "Use py_lib to see a package's API once you know it is installed.",
    "Use py_list instead of a bash `pip list`/`pip show` command — bash is disabled in this project.",
  ],
  parameters: Type.Object({
    package: Type.Optional(
      Type.String({
        description: "Filter by name (substring). An exact name shows that package's details.",
      })
    ),
  }),
};
