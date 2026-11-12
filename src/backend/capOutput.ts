import { Type } from "typebox";

/**
 * Shared output caps for every tool that returns content: one call must not be able to flood a
 * small model's context. The caps are the default; a tool's `uncapped` parameter (below) is the
 * LLM's explicit way to bypass them. All capping in the extension goes through `capLines` /
 * `capText` here.
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

export interface Capped<T> {
  items: T[];
  truncated: boolean;
}

/**
 * Caps a list of lines at maxLines lines / maxBytes bytes (whichever is hit first), trimming
 * whole items off the end so no partial line is returned; at least one item is always kept.
 * `uncapped: true` returns the list untouched. `sizeOf` defaults to the item's UTF-8 length plus
 * one separator byte.
 */
export function capLines<T>(items: T[], opts: CapOptions & { sizeOf?: (item: T) => number } = {}): Capped<T> {
  if (opts.uncapped) return { items, truncated: false };
  const maxLines = opts.maxLines ?? DEFAULT_MAX_LINES;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const sizeOf = opts.sizeOf ?? ((item) => Buffer.byteLength(String(item), "utf8") + 1);

  let selected = items.length > maxLines ? items.slice(0, maxLines) : items;
  let truncated = items.length > maxLines;
  let bytes = -1; // no separator before the first item
  let lastUnder = 0;
  for (let i = 0; i < selected.length; i++) {
    bytes += sizeOf(selected[i]!);
    if (bytes > maxBytes && i > 0) {
      truncated = true;
      break;
    }
    lastUnder = i + 1;
  }
  if (lastUnder < selected.length) selected = selected.slice(0, lastUnder);
  return { items: selected, truncated };
}

export interface CappedText {
  text: string;
  truncated: boolean;
}

/** `capLines` for plain text: splits on newlines, caps, rejoins. */
export function capText(text: string, opts: CapOptions = {}): CappedText {
  const capped = capLines(text.split("\n"), opts);
  return { text: capped.items.join("\n"), truncated: capped.truncated };
}

/** The hint appended to capped output, telling the model how to get the rest. */
export function capHint(): string {
  return `[Output truncated at ${DEFAULT_MAX_LINES} lines / ${DEFAULT_MAX_BYTES / 1024} KB. Pass uncapped: true to get the full output.]`;
}
