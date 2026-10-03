import type { UsageKind } from "./types.ts";
import { escapeForRegex, wordBoundary } from "./shared.ts";

const MODIFIERS = "public|private|protected|internal|static|virtual|override|sealed|abstract|async|readonly";

/**
 * Classifies a single line's usage of `symbol` in a C# file. Returns `null` when the line contains
 * no word-boundary occurrence of `symbol` at all.
 *
 * `new` unambiguously marks instantiation, same as TypeScript. Method/constructor definitions are
 * detected via a leading access-modifier chain, since C# always requires one of those (or at least
 * an implicit-private signature at class scope) before a method signature.
 *
 * Checks run in priority order and the first match wins (see python.ts's docstring for why).
 */
export function classifyCSharpLine(line: string, symbol: string): UsageKind | null {
  const s = escapeForRegex(symbol);
  const b = wordBoundary(symbol);

  if (new RegExp(`^\\s*using\\s+.*${b}`).test(line)) return "import";

  if (new RegExp(`\\b(?:class|struct|interface|enum|record)\\s+${s}\\b`).test(line)) return "definition";
  // Ordinary method: modifier chain, then a return type, then Symbol(
  if (new RegExp(`^\\s*(?:(?:${MODIFIERS})\\s+)+[\\w<>\\[\\],.]+\\s+${s}\\s*\\(`).test(line)) return "definition";
  // Constructor: modifier chain directly followed by Symbol( (no return type — name equals the class)
  if (new RegExp(`^\\s*(?:(?:public|private|protected|internal)\\s+)+${s}\\s*\\(`).test(line)) return "definition";

  if (new RegExp(`\\bnew\\s+${s}\\b`).test(line)) return "instantiation";

  if (new RegExp(`:\\s*${s}\\b`).test(line)) return "type-reference"; // base class / interface
  if (new RegExp(`<\\s*${s}\\b`).test(line)) return "type-reference"; // generic, e.g. List<Symbol>
  if (new RegExp(`\\(\\s*${s}\\s+\\w+`).test(line)) return "type-reference"; // parameter type
  if (new RegExp(`(?:^|[,(]\\s*)${s}\\s+\\w+\\s*[,)]`).test(line)) return "type-reference"; // param type, mid/end of list
  if (new RegExp(`(?:^\\s*|[=;{]\\s*)(?:(?:${MODIFIERS})\\s+)*${s}\\s+\\w+\\s*[=;]`).test(line)) return "type-reference"; // variable/field decl
  if (new RegExp(`(?:^\\s*|[=;{]\\s*)(?:(?:${MODIFIERS})\\s+)*${s}\\s+\\w+\\s*\\(`).test(line)) return "type-reference"; // return type

  if (new RegExp(`${b}\\.\\w+`).test(line)) return "static-access"; // Symbol.member
  if (new RegExp(`\\.\\s*${b}`).test(line)) return "static-access"; // obj.Symbol

  if (new RegExp(`${b}\\s*\\(`).test(line)) return "call";

  if (new RegExp(b).test(line)) return "reference";

  return null;
}
