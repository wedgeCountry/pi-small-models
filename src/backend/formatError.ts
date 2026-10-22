/**
 * Unified error-message formatting for every error a tool throws.
 *
 * Produces a single, predictable shape:
 *
 *   <tool> error: <message>
 *   Parameters: key=value, key=value
 *
 * The `Parameters` line lists only the arguments that were actually supplied (undefined values,
 * functions, and AbortSignals are skipped) and truncates long values, so the model gets an
 * informative but compact view of what the failing call looked like without dumping full file
 * contents or internal options into its context.
 */

const MAX_VALUE_LENGTH = 120;

function formatValue(value: unknown): string {
  let repr: string;
  try {
    repr = JSON.stringify(value) ?? "null";
  } catch {
    return "[unserializable]";
  }
  if (repr.length > MAX_VALUE_LENGTH) repr = `${repr.slice(0, MAX_VALUE_LENGTH - 3)}...`;
  return repr;
}

function isActiveParameter(value: unknown): boolean {
  if (value === undefined) return false;
  if (typeof value === "function") return false;
  if (typeof AbortSignal !== "undefined" && value instanceof AbortSignal) return false;
  return true;
}

export function formatError(toolName: string, message: string, parameters: Record<string, unknown> = {}): string {
  const active = Object.entries(parameters).filter(([, value]) => isActiveParameter(value));
  const lines = [`${toolName} error: ${message}`];
  if (active.length > 0) {
    lines.push(`Parameters: ${active.map(([key, value]) => `${key}=${formatValue(value)}`).join(", ")}`);
  }
  return lines.join("\n");
}

/** Convenience wrapper so a tool throws with the unified format in one call. */
export function toolError(toolName: string, message: string, parameters: Record<string, unknown> = {}): Error {
  return new Error(formatError(toolName, message, parameters));
}
