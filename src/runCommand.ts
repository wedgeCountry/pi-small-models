import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

export interface RunCommandOptions {
  cwd: string;
  signal?: AbortSignal;
  /** Defaults to 10MB. */
  maxBuffer?: number;
  env?: NodeJS.ProcessEnv;
}

export interface RunCommandResult {
  stdout: string;
  stderr: string;
  /** Process exit code; 0 = success. */
  exitCode: number;
}

/** Thrown when the executable itself can't be found (ENOENT). */
export class CommandNotFoundError extends Error {
  constructor(public readonly command: string) {
    super(`${command} is not installed or not on PATH`);
    this.name = "CommandNotFoundError";
  }
}

/**
 * Runs `command args` via `execFile` (array args, no shell) and returns stdout/stderr/exit code
 * whether or not the process succeeded.
 *
 * Node's promisified `execFile` *rejects* on a non-zero exit (it has no `reject: false` option —
 * that's execa's API), attaching `code`/`stdout`/`stderr` to the error. This helper turns that
 * rejection back into a normal result, so a tool like `npm list` (non-zero on missing peer deps)
 * or `tsc` (non-zero on type errors) still reports its real output.
 *
 * - An already-aborted or aborted-in-flight `signal` rejects with the `AbortError`.
 * - A missing executable rejects with `CommandNotFoundError`.
 * - Anything else (e.g. maxBuffer exceeded) is rethrown unchanged.
 */
export async function runCommand(
  command: string,
  args: readonly string[],
  opts: RunCommandOptions
): Promise<RunCommandResult> {
  opts.signal?.throwIfAborted();
  try {
    const { stdout, stderr } = await execFile(command, args as string[], {
      cwd: opts.cwd,
      signal: opts.signal,
      maxBuffer: opts.maxBuffer ?? 10 * 1024 * 1024,
      encoding: "utf8",
      env: opts.env,
      windowsHide: true,
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { code?: unknown; stdout?: string; stderr?: string };
    if (e.name === "AbortError") throw err;
    if (e.code === "ENOENT") throw new CommandNotFoundError(command);
    if (typeof e.code === "number") {
      return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", exitCode: e.code };
    }
    throw err;
  }
}

/** Best human-readable description of an unexpected `runCommand` failure. */
export function describeCommandError(err: unknown): string {
  const e = err as NodeJS.ErrnoException & { stderr?: string };
  return e.stderr?.trim() || e.message || String(err);
}
