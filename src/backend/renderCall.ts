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
