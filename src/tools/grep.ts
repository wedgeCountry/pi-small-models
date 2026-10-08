import fg from "fast-glob";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Worker } from "node:worker_threads";
import { DEFAULT_IGNORE_GLOBS, getEffectiveIgnoreGlobs } from "../ignore.ts";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { GREP_TOOL_DEFINITION } from "../tool_definitions/grep.ts";
import type { ToolRegistry } from "../sandbox/permissionGate.ts";
import { sandboxFor, type Sandbox } from "../sandbox/sandbox.ts";
import { oneLine, callName } from "../renderCall.ts";
import { withConciseValidationErrors } from "../toolValidation.ts";

export interface GrepOptions {
  glob?: string;
  ignoreCase?: boolean;
  maxResults?: number;
  contextLines?: number;
  signal?: AbortSignal;
  /** Hard wall-clock budget for the scan, in ms. Guards against catastrophic regex backtracking. */
  timeoutMs?: number;
  /** Ignore globs to apply. Defaults to `DEFAULT_IGNORE_GLOBS` — pass `getEffectiveIgnoreGlobs()`'s result to also honor `/ignore`'s global and local ignore files. */
  ignoreGlobs?: string[];
}

export interface GrepLine {
  file: string;
  line: number;
  text: string;
  isMatch: boolean;
}

export interface GrepResult {
  lines: GrepLine[];
  matchCount: number;
  filesScanned: number;
  truncated: boolean;
}

const DEFAULT_TIMEOUT_MS = 5000;
const WORKER_URL = new URL("./grepWorker.mjs", import.meta.url);

/** Searches file contents under `target` (resolved through `sb`) for a regex/plain-text pattern. */
export async function grepFiles(sb: Sandbox, target: string, pattern: string, opts: GrepOptions = {}): Promise<GrepResult> {
  const base = sb.resolve(target);
  const max = opts.maxResults ?? 200;
  const context = opts.contextLines ?? 0;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const flags = opts.ignoreCase ? "i" : "";

  try {
    new RegExp(pattern, flags); // validate syntax before spending a worker on it
  } catch (err) {
    throw new Error(`Invalid pattern: ${(err as Error).message}`);
  }

  // `base` is meant to be a directory that fast-glob walks with `cwd`, not the
  // file being searched — that's what `glob` is for. Passing a file path here
  // used to surface as a raw `ENOTDIR: not a directory, scandir '<path>'` from
  // fast-glob/Node once it tried to readdir a non-directory; catch it earlier
  // with a message that says what went wrong and how to fix it.
  let baseStat;
  try {
    baseStat = await fs.stat(base);
  } catch {
    throw new Error(`grep path "${base}" does not exist.`);
  }
  if (!baseStat.isDirectory()) {
    throw new Error(
      `grep path "${base}" is a file, not a directory. "path" must name a directory to search within; ` +
        `to search a single file, keep "path" pointed at its containing directory and pass the filename via "glob" instead, ` +
        `e.g. { path: ".", glob: "main.py" }.`
    );
  }

  const entries = await fg(opts.glob ?? "**/*", {
    cwd: base,
    ignore: opts.ignoreGlobs ?? DEFAULT_IGNORE_GLOBS,
    onlyFiles: true,
    dot: false,
    followSymbolicLinks: false,
    objectMode: true,
  });
  // followSymbolicLinks: false only stops fast-glob from descending into a symlinked directory; a
  // symlinked file still comes back, so every entry goes through the sandbox's filter here. This is
  // the only check: the worker reads exactly the files it is handed and knows no rules.
  const allowed = sb.entryFilter(base);
  const files = entries
    .filter((e) => allowed(e.path, e.dirent.isSymbolicLink()))
    .map((e) => e.path)
    .sort((a, b) => a.localeCompare(b));

  return scanInWorker({ base, files, pattern, flags, max, context }, timeoutMs, opts.signal);
}

interface ScanInput {
  base: string;
  /** Paths relative to `base`, already approved by the sandbox. */
  files: string[];
  pattern: string;
  flags: string;
  max: number;
  context: number;
}

/**
 * Runs the actual regex matching on a disposable worker thread with a hard
 * timeout. A pathological pattern (catastrophic backtracking) can only hang
 * the worker, which we then terminate, instead of freezing the whole process
 * — the main-thread AbortSignal check alone can't interrupt a single
 * in-progress synchronous RegExp.test() call.
 */
function scanInWorker(input: ScanInput, timeoutMs: number, signal?: AbortSignal): Promise<GrepResult> {
  return new Promise((resolve, reject) => {
    // Plain .mjs worker - no special execArgv needed
    let worker: Worker | null = null;
    let settled = false;
    let timedOut = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(startupTimeout);
      signal?.removeEventListener("abort", onAbort);
      fn();
    };

    const timer = setTimeout(() => {
      timedOut = true;
      finish(() => {
        if (worker) worker.terminate();
        reject(
          new Error(
            `grep pattern "${input.pattern}" took longer than ${timeoutMs}ms to evaluate — it may be causing catastrophic backtracking; try a simpler pattern or narrow "glob"/"path"`
          )
        );
      });
    }, timeoutMs);

    // Startup timeout: if worker doesn't send anything in 1 second, something is wrong
    const startupTimeout = setTimeout(() => {
      if (!settled) {
        finish(() => {
          if (worker) worker.terminate();
          reject(new Error("Worker failed to initialize within 1 second"));
        });
      }
    }, 1000);

    const onAbort = () => {
      finish(() => {
        if (worker) worker.terminate();
        reject(new Error("Aborted"));
      });
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    try {
      worker = new Worker(WORKER_URL, {
        workerData: input,
      });

      worker.once("message", (msg: GrepResult | { error: string }) => {
        finish(() => {
          worker!.terminate();
          if ("error" in msg) reject(new Error(msg.error));
          else resolve(msg);
        });
      });

      worker.once("error", (err) => {
        finish(() => reject(err));
      });
    } catch (err) {
      finish(() => reject(err));
    }
  });
}



export function registerGrepTool(pi: ToolRegistry) {
  pi.registerTool({
    ...GREP_TOOL_DEFINITION,
    prepareArguments: withConciseValidationErrors(GREP_TOOL_DEFINITION.name, GREP_TOOL_DEFINITION.parameters),
    renderCall(args, theme) {
      let text = `${callName(theme, "grep")} ${theme.fg("accent", `/${args.pattern ?? ""}/`)}`;
      text += theme.fg("toolOutput", ` in ${args.path ?? "."}`);
      if (args.glob) text += theme.fg("toolOutput", ` (${args.glob})`);
      if (args.ignoreCase) text += theme.fg("toolOutput", " -i");
      if (args.maxResults !== undefined) text += theme.fg("toolOutput", ` limit ${args.maxResults}`);
      return oneLine(text);
    },
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const ignoreGlobs = await getEffectiveIgnoreGlobs(ctx.cwd, getAgentDir());
      const result = await grepFiles(sandboxFor(ctx.cwd), params.path ?? ".", params.pattern, {
        glob: params.glob,
        ignoreCase: params.ignoreCase,
        maxResults: params.maxResults,
        contextLines: params.contextLines,
        signal,
        ignoreGlobs,
      });

      const text = result.lines.length
        ? result.lines.map((l) => `${l.file}${l.isMatch ? ":" : "-"}${l.line}${l.isMatch ? ":" : "-"}${l.text}`).join("\n") +
          (result.truncated ? `\n… results truncated at ${params.maxResults ?? 200} matches` : "")
        : "No matches found.";

      return {
        content: [{ type: "text", text }],
        details: { matchCount: result.matchCount, filesScanned: result.filesScanned, truncated: result.truncated },
      };
    },
  });
}
