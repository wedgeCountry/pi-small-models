import { Type } from "typebox";

export const PY_IMPORT_TOOL_DEFINITION = {
  name: "py_import",
  label: "Python Import Check",
  description:
    "Import every Python file in the project to check it compiles and its top-level imports resolve. " +
    "Runs the project's Python interpreter (same discovery as py_lib) with each file's parent directory on sys.path. " +
    "Returns an error when any file fails. Files matching the ignore globs (node_modules, .venv, __pycache__, dist, build, ...) are skipped.",
  parameters: Type.Object({
    path: Type.Optional(
      Type.String({
        description: "Path to check, relative to the project root. Defaults to the current directory.",
      })
    ),
  }),
};
