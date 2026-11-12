import { Type } from "typebox";

/**
 * Shared output caps for every tool that returns content: one call must not be able to flood a
 * small model's context. The caps are the default; a tool's `uncapped` parameter (below) is the
 * LLM's explicit way to bypass them.
 */
export const DEFAULT_MAX_LINES = 2000;
export const DEFAULT_MAX_BYTES = 50 * 1024; // 50KB

/** The `uncapped` parameter shared by all content-returning tools. */
export const uncappedParam = Type.Optional(
  Type.Boolean({
    description: "Return the full output, bypassing the default line/byte cap. Defaults to false.",
    default: false,
  })
);

export interface CapOptions {
  uncapped?: boolean;
  maxLines?: number;
  maxBytes?: number;
}

export interface CappedText {
  text: string;
  truncated: boolean;
}

/**
 * Caps `text` at maxLines lines / maxBytes bytes (whichever is hit first), trimming whole lines
 * off the end so no partial line is returned. `uncapped: true` returns the text untouched.
 */
export function capText(text: string, opts: CapOptions = {}): CappedText {
  if (opts.uncapped) return { text, truncated: false };
  const maxLines = opts.maxLines ?? DEFAULT_MAX_LINES;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;

  let lines = text.split("\n");
  let truncated = lines.length > maxLines;
  if (truncated) lines = lines.slice(0, maxLines);
  while (lines.length > 1 && Buffer.byteLength(lines.join("\n"), "utf8") > maxBytes) {
    lines = lines.slice(0, -1);
    truncated = true;
  }
  return { text: lines.join("\n"), truncated };
}

/** The hint appended to capped output, telling the model how to get the rest. */
export function capHint(): string {
  return `[Output truncated at ${DEFAULT_MAX_LINES} lines / ${DEFAULT_MAX_BYTES / 1024} KB. Pass uncapped: true to get the full output.]`;
}
