/** A bare identifier: letters/underscore start, then word characters. Anything else is rejected by
 * `find_usages` before it ever reaches a classifier, so these helpers can assume a clean input. */
const IDENTIFIER_RE = /^[A-Za-z_]\w*$/;

export function isValidIdentifier(symbol: string): boolean {
  return IDENTIFIER_RE.test(symbol);
}

/** Escapes a symbol for interpolation into a `RegExp` source string. Identifiers matching
 * `IDENTIFIER_RE` contain no regex metacharacters, so this is a defensive no-op in practice —
 * kept so a classifier never builds an invalid/unintended pattern if that invariant is ever
 * loosened. */
export function escapeForRegex(symbol: string): string {
  return symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `\b<symbol>\b` with the symbol escaped — the word-boundary form every classifier builds on. */
export function wordBoundary(symbol: string): string {
  return `\\b${escapeForRegex(symbol)}\\b`;
}
