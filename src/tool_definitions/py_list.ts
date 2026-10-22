import { Type } from "typebox";

export const PY_LIST_TOOL_DEFINITION = {
  name: "py_list",
  label: "Py List",
  description:
    "List the Python packages installed for the project's interpreter.",
  parameters: Type.Object({
    package: Type.Optional(
      Type.String({
        description: "Filter by name (substring). An exact name shows that package's details.",
      })
    ),
  }),
};
