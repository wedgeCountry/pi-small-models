import { Compile } from "typebox/compile";
import { Value } from "typebox/value";
import type { TSchema } from "typebox";

type Validator = ReturnType<typeof Compile>;
type ValidationError = ReturnType<Validator["Errors"]> extends Iterable<infer T> ? T : never;

const validatorCache = new WeakMap<TSchema, Validator>();

function getValidator(schema: TSchema): Validator {
  let validator = validatorCache.get(schema);
  if (!validator) {
    validator = Compile(schema);
    validatorCache.set(schema, validator);
  }
  return validator;
}

// Mirrors the framework's own error-path formatting (same typebox error shape), so a "required"
// error names the missing property rather than its (unhelpful, often-empty) parent instancePath.
function formatValidationPath(error: ValidationError): string {
  const requiredProperty = (error as { params?: { requiredProperties?: string[] } }).params?.requiredProperties?.[0];
  if (error.keyword === "required" && requiredProperty) {
    const basePath = error.instancePath.replace(/^\//, "").replace(/\//g, ".");
    return basePath ? `${basePath}.${requiredProperty}` : requiredProperty;
  }
  const path = error.instancePath.replace(/^\//, "").replace(/\//g, ".");
  return path || "root";
}

/**
 * Pulls the top-level argument name out of each "  - path.to.field: message" line, keeping only
 * names actually present in `argNames` (a "required property" error names the *missing*
 * property, which by definition isn't one of these).
 */
function extractNamedArgs(errors: ValidationError[], argNames: ReadonlySet<string>): string[] {
  const named: string[] = [];
  for (const error of errors) {
    const topLevelKey = formatValidationPath(error).split(".")[0]!;
    if (argNames.has(topLevelKey) && !named.includes(topLevelKey)) {
      named.push(topLevelKey);
    }
  }
  return named;
}

/**
 * Builds a short validation-failure message for a tool call: the per-field error lines, the
 * names of the arguments actually received, and — only for an argument a message actually
 * names — that one argument's value. Replaces the framework's default message, which dumps the
 * tool's complete raw JSON arguments on every mistake: disproportionately expensive for a small
 * model that just needs to know which field was wrong.
 *
 * Runs the same Convert-then-Check typebox validates against the schema the framework itself
 * compiles from (`tool.parameters`), so a call this accepts is one the framework accepts too.
 * It intentionally skips the framework's extra null-stripping normalization pass for optional
 * properties (a convenience for literal `null`, not a correctness requirement) since `Value.
 * Convert` already coerces `null` to a type-appropriate value for every primitive type tested
 * here, converging on the same valid/invalid verdict.
 */
function formatConciseValidationError(toolName: string, schema: TSchema, args: unknown): string | undefined {
  const validator = getValidator(schema);
  const candidate = structuredClone(args);
  Value.Convert(schema, candidate);
  if (validator.Check(candidate)) {
    return undefined;
  }

  const errors = [...validator.Errors(candidate)];
  const errorLines = errors.map((error) => `  - ${formatValidationPath(error)}: ${error.message}`).join("\n");

  const argNames =
    typeof args === "object" && args !== null && !Array.isArray(args) ? Object.keys(args as Record<string, unknown>) : [];

  const lines = [`Validation failed for tool "${toolName}":`, errorLines || "  Unknown validation error"];
  if (argNames.length > 0) {
    lines.push("", `Received argument names: ${argNames.join(", ")}`);
  }

  const record = args as Record<string, unknown>;
  for (const key of extractNamedArgs(errors, new Set(argNames))) {
    lines.push(`${key}: ${JSON.stringify(record[key])}`);
  }

  return lines.join("\n");
}

/**
 * Tool-definition `prepareArguments` hook that throws the concise message above instead of
 * letting a validation failure fall through to the framework's own, much more verbose, error.
 * `prepareArguments` runs before the framework's schema validation, so a thrown Error here
 * replaces its message entirely; a call this lets through still goes on to that real validation
 * unchanged, so the success path's behavior is untouched.
 */
export function withConciseValidationErrors<TParams extends TSchema>(name: string, parameters: TParams) {
  return (args: unknown) => {
    const message = formatConciseValidationError(name, parameters, args);
    if (message !== undefined) {
      throw new Error(message);
    }
    return args as any;
  };
}
