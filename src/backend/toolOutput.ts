import { escapeTripleBackticks } from "./escapeBackticks.ts";

/**
 * The single factory every tool uses to build its `execute()` return value, so all 18 tools answer
 * in the same structured shape — the one the framework turns into the model-facing
 * `{ role: "toolResult", toolName, content, isError }` message:
 *
 *   { content: [{ type: "text", text }], details }
 *
 * `text` is the model-facing answer and always runs through `escapeTripleBackticks`, so no tool can
 * leak a literal ``` into the transcript (where it would break into or out of a markdown code
 * block); `details` stays untouched for the UI and programmatic callers.
 */
export function toolOutput(details: object, text: string): {
  content: { type: "text"; text: string }[];
  details: object;
} {
  return {
    content: [{ type: "text", text: escapeTripleBackticks(text) }],
    details,
  };
}
