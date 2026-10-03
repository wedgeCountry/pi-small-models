import type { UsageKind } from "./types.ts";
import { escapeForRegex, wordBoundary } from "./shared.ts";

/**
 * Python has no `new` keyword, so a bare `Symbol(` is structurally identical whether `Symbol` is a
 * function or a class — `detectPythonKind` resolves that ahead of time by checking whether a
 * `def`/`class` line for the symbol exists anywhere in the scanned scope, so `classifyPythonLine`
 * can label bare calls accurately instead of guessing. "unknown" (neither or both found) is reported
 * honestly as "invocation" rather than silently picking one.
 */
export type PythonKnownKind = "function" | "class" | "unknown";

export function detectPythonKind(lines: readonly string[], symbol: string): PythonKnownKind {
  const s = escapeForRegex(symbol);
  const classDefRe = new RegExp(`^\\s*class\\s+${s}\\s*[:(]`);
  const funcDefRe = new RegExp(`^\\s*(?:async\\s+)?def\\s+${s}\\s*\\(`);

  let hasClass = false;
  let hasFunc = false;
  for (const line of lines) {
    if (classDefRe.test(line)) hasClass = true;
    if (funcDefRe.test(line)) hasFunc = true;
  }
  if (hasClass && !hasFunc) return "class";
  if (hasFunc && !hasClass) return "function";
  return "unknown";
}

/**
 * Classifies a single line's usage of `symbol` in a Python file. Returns `null` when the line
 * contains no word-boundary occurrence of `symbol` at all.
 *
 * Checks run in priority order and the first match wins — a line that happens to satisfy more than
 * one pattern (e.g. a typed assignment that's also a call on the same line) is reported as whichever
 * category is checked first, documented per-case in the test suite rather than attempted in full.
 */
export function classifyPythonLine(
  line: string,
  symbol: string,
  knownKind: PythonKnownKind = "unknown"
): UsageKind | null {
  const s = escapeForRegex(symbol);
  const b = wordBoundary(symbol);

  if (new RegExp(`^\\s*from\\s+\\S+\\s+import\\s+.*${b}`).test(line)) return "import";
  if (new RegExp(`^\\s*import\\s+.*${b}`).test(line)) return "import";

  if (new RegExp(`^\\s*class\\s+${s}\\s*[:(]`).test(line)) return "definition";
  if (new RegExp(`^\\s*(?:async\\s+)?def\\s+${s}\\s*\\(`).test(line)) return "definition";

  if (new RegExp(`:\\s*${s}\\b`).test(line)) return "type-reference"; // parameter/variable annotation
  if (new RegExp(`->\\s*${s}\\b`).test(line)) return "type-reference"; // return annotation
  if (new RegExp(`\\[\\s*${s}\\b`).test(line)) return "type-reference"; // generic, e.g. List[Symbol]
  if (new RegExp(`class\\s+\\w+\\s*\\([^)]*${b}[^)]*\\)`).test(line)) return "type-reference"; // base class

  if (new RegExp(`${b}\\.\\w+`).test(line)) return "static-access"; // Symbol.member
  if (new RegExp(`\\.\\s*${b}`).test(line)) return "static-access"; // obj.Symbol

  if (new RegExp(`${b}\\s*\\(`).test(line)) {
    if (knownKind === "class") return "instantiation";
    if (knownKind === "function") return "call";
    return "invocation";
  }

  if (new RegExp(b).test(line)) return "reference"; // e.g. passed by name: callback=Symbol

  return null;
}
