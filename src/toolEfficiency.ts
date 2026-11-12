/**
 * Injected once into the system prompt (not per tool): how to spend context tokens efficiently.
 * Deliberately short — a long guideline would defeat its own purpose.
 */
export const TOOL_EFFICIENCY_GUIDELINES = [
  "Use peek for a file overview; use read only for the exact lines you must see — read is the ultima ratio.",
  "Use find_usages for class/function lookups; use grep only for arbitrary text or patterns.",
  "Use git_diff with nameOnly first, then scope by path. Pass uncapped: true only when you truly need the full output.",
];
