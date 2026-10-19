/**
 * Checks if the given signal has been aborted.
 * Throws AbortError if aborted, does nothing otherwise.
 * This is a convenience wrapper for optional signal checking.
 */
export function checkAborted(signal?: AbortSignal): void {
  signal?.throwIfAborted();
}

/**
 * Validates that a value is a positive integer.
 * Throws RangeError if the value is not a positive integer.
 * @param value - The value to validate
 * @param name - The name of the parameter (for error messages)
 */
export function validatePositiveInteger(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer, got ${value}`);
  }
  return value;
}

/**
 * Validates that a value is a non-negative integer.
 * Throws RangeError if the value is not a non-negative integer.
 * @param value - The value to validate
 * @param name - The name of the parameter (for error messages)
 */
export function validateNonNegativeInteger(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer, got ${value}`);
  }
  return value;
}
