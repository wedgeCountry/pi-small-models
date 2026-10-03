import { Type } from "typebox";
import { FIND_USAGES_LANGUAGES } from "../tools/usageRules/registry.ts";

export const FIND_USAGES_TOOL_DEFINITION = {
  name: "find_usages",
  label: "Find Usages",
  description:
    "Find structural usages of a class or function name across a Python, TypeScript/JavaScript, or " +
    "C# codebase — definitions, instantiations, imports, type references, qualified access, and plain " +
    "calls, each labeled with how it's used.",
  promptSnippet: "find_usages: locate usages of a class/function name, labeled by how they're used",
  promptGuidelines: [
    "Use find_usages to see everywhere a class or function name is defined, imported, instantiated, " +
      "referenced as a type, or called, before renaming or changing its signature.",
    "This is regex-based, not a type checker: it can't resolve a call made through a variable of " +
      "unknown type (e.g. `handler.process()`), and two symbols with the same name in different " +
      "files/scopes are not distinguished. Results labeled \"reference\" or \"invocation\" are the " +
      "ones worth double-checking by eye.",
    "\"symbol\" must be a plain identifier (letters, digits, underscores, not starting with a digit) " +
      "— it is matched case-sensitively as a whole word, never as a partial/substring match.",
  ],
  parameters: Type.Object({
    symbol: Type.String({
      description: "The class or function name to search for. Matched case-sensitively as a whole identifier.",
    }),
    language: Type.Union(
      FIND_USAGES_LANGUAGES.map((lang) => Type.Literal(lang)),
      { description: "Which language's usage patterns to apply." }
    ),
    path: Type.Optional(
      Type.String({ description: 'Base directory to search from, relative to the project root. Defaults to ".".' })
    ),
    maxResults: Type.Optional(
      Type.Integer({ description: "Maximum number of matching lines to return.", default: 200 })
    ),
  }),
};
