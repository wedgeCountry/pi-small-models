import { Type } from "typebox";
import { libQueryGuidelines, libQueryParameters } from "./libShared.ts";

export const TS_LIB_TOOL_DEFINITION = {
  name: "ts_lib",
  label: "TS Lib",
  description:
    "Show the API (signatures + docs) of an installed npm package (TypeScript/JavaScript) from its type declarations.",
  promptGuidelines: [
    "Use npm_list to see which packages are installed.",
  ],
  parameters: Type.Object(
    libQueryParameters({ package: "zod", module: "zod/v4", symbol: "ZodObject.extend" })
  ),
};
