import { Type } from "typebox";
import { libQueryGuidelines, libQueryParameters } from "./libShared.ts";

export const TS_LIB_TOOL_DEFINITION = {
  name: "ts_lib",
  label: "TS Lib",
  description:
    "Show the API of an installed npm package (TypeScript/JavaScript) from its type declarations: version, entry points, exports, and exact signatures with JSDoc for one symbol.",
  promptSnippet: "ts_lib: look up the real API (signatures + docs) of an installed npm package",
  promptGuidelines: [
    ...libQueryGuidelines("ts_lib", "npm"),
    'Use module for subpath exports, e.g. module="zod/v4" or module="lodash/fp"; the overview lists the available modules.',
    "Use npm_list to see which packages are installed; ts_lib reads one package's API.",
  ],
  parameters: Type.Object(
    libQueryParameters({ package: "zod", module: "zod/v4", symbol: "ZodObject.extend" })
  ),
};
