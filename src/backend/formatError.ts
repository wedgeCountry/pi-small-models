/**
 * Unified error-message formatting for every error a tool throws.
 *
 * Produces a single, predictable shape:
 *
 *   <tool> error: <message>
 *
 * With debug mode on (`pi --debug`, see `setDebugMode`) a second line is appended:
 *
 *   Parameters: key=value, key=value
 *
 * listing only the arguments that were actually supplied (undefined values, functions, and
 * AbortSignals are skipped) and truncating long values. Debug off, the model gets just the message:
 * the parameter echo can repeat large payloads (e.g. edit's oldText/newText) into its context.
 */

let debugMode = false;

/** Turns the `Parameters:` line in error output on/off. Wired to the `--debug` CLI flag in index.ts. */
export function setDebugMode(enabled: boolean): void {
  debugMode = enabled;
}

export function isDebugMode(): boolean {
  return debugMode;
}

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
  const lines = [`${toolName} error: ${message}`];
  if (debugMode) {
    const active = Object.entries(parameters).filter(([, value]) => isActiveParameter(value));
    if (active.length > 0) {
      lines.push(`Parameters: ${active.map(([key, value]) => `${key}=${formatValue(value)}`).join(", ")}`);
    }
  }
  return lines.join("\n");
}

/** Convenience wrapper so a tool throws with the unified format in one call. */
export function toolError(toolName: string, message: string, parameters: Record<string, unknown> = {}): Error {
  const err = new Error(formatError(toolName, message, parameters));
  (err as Error & { toolFormatted?: boolean }).toolFormatted = true;
  return err;
}

/** True when `err` was already produced by `toolError`/`formatError` — don't wrap it again. */
export function isToolFormattedError(err: unknown): boolean {
  return err instanceof Error && (err as Error & { toolFormatted?: boolean }).toolFormatted === true;
}
