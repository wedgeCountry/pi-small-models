/**
 * The classification `find_usages` assigns to a single matching line. These are structural
 * categories a regex can honestly detect — not a semantic resolution of the symbol's real type or
 * scope (e.g. a call through a variable of unknown type falls back to "reference"/"call" rather
 * than being falsely resolved).
 */
export type UsageKind =
  | "import"
  | "definition"
  | "instantiation"
  | "type-reference"
  | "static-access"
  | "call"
  | "invocation"
  | "reference";
