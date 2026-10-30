import type { Theme } from "@earendil-works/pi-coding-agent";

/**
 * A tool's `renderCall` must return a `Component` — pi-tui's `{ render(width): string[] }`
 * shape. Every tool here only ever shows a single themed line, so this tiny local shape is used
 * instead of importing pi-tui's `Text` component just to wrap a string (pi-tui isn't a dependency
 * of this project, and doesn't need to become one for this).
 */
export function oneLine(text: string): { render(): string[]; invalidate(): void } {
  return { render: () => [text], invalidate: () => {} };
}

/** The tool's own name, styled the same way Pi's built-in tools render theirs. */
export function callName(theme: Theme, name: string): string {
  return theme.fg("toolTitle", theme.bold(name));
}

/**
 * The one-line `renderCall` shape shared by every tool here: `name main extra1 extra2 …`,
 * where `main` is accent-highlighted and each `extra` is a plain toolOutput-colored suffix.
 * Empty/undefined segments are omitted. Usage: `renderCall: (args, theme) =>
 * renderLine(theme, "write", args.path, …)`. A tool needing something fancier can still
 * write its own `renderCall` by hand.
 */
export function renderLine(
  theme: Theme,
  name: string,
  main: string | undefined,
  ...extras: (string | undefined)[]
): { render(): string[]; invalidate(): void } {
  let text = callName(theme, name);
  if (main !== undefined && main !== "") text += ` ${theme.fg("accent", main)}`;
  for (const extra of extras) {
    if (extra !== undefined && extra !== "") text += theme.fg("toolOutput", extra);
  }
  return oneLine(text);
}
