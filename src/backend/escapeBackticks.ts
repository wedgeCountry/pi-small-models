/**
 * Escapes triple backticks in a tool's returned text so raw ``` from file contents, diffs, grep
 * matches or error messages cannot terminate (or open) a markdown code block in the model's
 * transcript. Every backtick run of three or more is split with zero-width joiners, so the model
 * still reads it as backticks while no literal ``` survives anywhere in the text.
 */
export function escapeTripleBackticks(text: string): string {
  return text.replace(/`{3,}/g, (run) => "`\u200B".repeat(run.length - 1) + "`");
}
