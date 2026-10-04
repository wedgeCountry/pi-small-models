import { Type } from "typebox";
import { FIND_USAGES_LANGUAGES } from "../tools/usageRules/registry.ts";

export const FIND_USAGES_TOOL_DEFINITION = {
  name: "find_usages",
  label: "Find Usages",
  description: "Find structural usages of a class or function name across the project",
  promptGuidelines: ["use this tool over grep when you have an exact name",],
  parameters: Type.Object({
    symbol: Type.String({
      description: "The class or function name to search for. Matched case-sensitively as a whole identifier.",
    }),
    language: Type.Optional(
      Type.Union([Type.Literal("auto"), ...FIND_USAGES_LANGUAGES.map((lang) => Type.Literal(lang))], {
        description:
          'Which language\'s usage patterns to apply. Defaults to "auto", which detects the language. ' +
          "supported languages: " + FIND_USAGES_LANGUAGES ,
        default: "auto",
      })
    ),
    path: Type.Optional(
      Type.String({ description: 'Base directory to search from, relative to the project root. Defaults to ".".' })
    ),
    maxResults: Type.Optional(
      Type.Integer({ description: "Maximum number of matching lines to return.", default: 200 })
    ),
  }),
};
