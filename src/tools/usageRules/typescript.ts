import type { UsageKind } from "./types.ts";
import { escapeForRegex, wordBoundary } from "./shared.ts";

/**
 * Classifies a single line's usage of `symbol` in a TypeScript or JavaScript file. Returns `null`
 * when the line contains no word-boundary occurrence of `symbol` at all.
 *
 * Unlike Python, `new` unambiguously marks instantiation here, so there's no knownKind pre-pass
 * needed — a bare `Symbol(` with no `new` is simply a call.
 *
 * Checks run in priority order and the first match wins (see python.ts's docstring for why).
 */
export function classifyTypeScriptLine(line: string, symbol: string): UsageKind | null {
  const s = escapeForRegex(symbol);
  const b = wordBoundary(symbol);

  if (new RegExp(`^\\s*import\\b.*${b}`).test(line)) return "import";
  if (/\brequire\(/.test(line) && new RegExp(b).test(line)) return "import";

  if (new RegExp(`\\bclass\\s+${s}\\b`).test(line)) return "definition";
  if (new RegExp(`\\binterface\\s+${s}\\b`).test(line)) return "definition";
  if (new RegExp(`\\btype\\s+${s}\\b\\s*=`).test(line)) return "definition";
  if (new RegExp(`\\bfunction\\s*\\*?\\s+${s}\\s*\\(`).test(line)) return "definition";
  if (new RegExp(`\\bconst\\s+${s}\\s*=\\s*(?:async\\s+)?\\(`).test(line)) return "definition"; // arrow fn, parenthesized params
  if (new RegExp(`\\bconst\\s+${s}\\s*=\\s*(?:async\\s+)?\\w+\\s*=>`).test(line)) return "definition"; // arrow fn, single bare param

  if (new RegExp(`\\bnew\\s+${s}\\b`).test(line)) return "instantiation";

  if (new RegExp(`:\\s*${s}\\b`).test(line)) return "type-reference"; // type annotation
  if (new RegExp(`<\\s*${s}\\b`).test(line)) return "type-reference"; // generic
  if (new RegExp(`\\bextends\\s+${s}\\b`).test(line)) return "type-reference";
  if (new RegExp(`\\bimplements\\s+${s}\\b`).test(line)) return "type-reference";

  if (new RegExp(`${b}\\.\\w+`).test(line)) return "static-access"; // Symbol.member
  if (new RegExp(`\\.\\s*${b}`).test(line)) return "static-access"; // obj.Symbol

  if (new RegExp(`${b}\\s*\\(`).test(line)) return "call";

  if (new RegExp(b).test(line)) return "reference"; // e.g. passed by reference: onClick={Symbol}

  return null;
}
