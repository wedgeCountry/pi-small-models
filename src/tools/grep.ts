import fg from "fast-glob";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Worker } from "node:worker_threads";
import { DEFAULT_IGNORE_GLOBS, getEffectiveIgnoreGlobs } from "../ignore.ts";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { GREP_TOOL_DEFINITION } from "../tool_definitions/grep.ts";
import { resolveSandboxPath, isEntrySandboxSafe, getSandboxState, type SandboxState } from "../sandbox.ts";
import { oneLine, callName } from "../renderCall.ts";

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
const WORKER_URL = new URL("./grepWorker.ts", import.meta.url);

/** Searches file contents under `base` for a regex/plain-text pattern. */
export async function grepFiles(base: string, pattern: string, opts: GrepOptions = {}): Promise<GrepResult> {
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
  // followSymbolicLinks: false only stops fast-glob from descending into a
  // symlinked directory — a symlinked file itself still comes back in the
  // list, so re-check every entry against the sandbox (restricted globs
  // apply regardless of symlink status) before the worker reads it. The
  // `isSymlink` flag rides along to `files` (rather than being dropped once
  // filtered) so `grepWorker.ts` can run this same check again independently
  // instead of just trusting this pre-filter — see the comment on
  // `scanInWorker`/`ScanInput` for why that re-check matters.
  const files: ScanFile[] = entries
    .filter((e) => isEntrySandboxSafe(base, e.path, "read", e.dirent.isSymbolicLink()))
    .map((e) => ({ path: e.path, isSymlink: e.dirent.isSymbolicLink() }))
    .sort((a, b) => a.path.localeCompare(b.path));

  return scanInWorker(
    { base, files, pattern, flags, max, context, sandboxState: getSandboxState() },
    timeoutMs,
    opts.signal
  );
}

export interface ScanFile {
  path: string;
  isSymlink: boolean;
}

interface ScanInput {
  base: string;
  files: ScanFile[];
  pattern: string;
  flags: string;
  max: number;
  context: number;
  /**
   * The main thread's sandbox state at the moment this scan was kicked off,
   * handed to the worker explicitly because `grepWorker.ts` runs in a
   * separate `worker_threads` isolate — importing `sandbox.ts` there gets an
   * independent copy of its module-level state (starting from `"on"`, not
   * whatever this process's state actually is), so without this the worker's
   * own re-verification would silently diverge from the main thread's.
   */
  sandboxState: SandboxState;
}

/**
 * Runs the actual regex matching on a disposable worker thread with a hard
 * timeout. A pathological pattern (catastrophic backtracking) can only hang
 * the worker, which we then terminate, instead of freezing the whole process
 * — the main-thread AbortSignal check alone can't interrupt a single
 * in-progress synchronous RegExp.test() call.
 *
 * `input.files` was already sandbox-filtered on the main thread above, but
 * `grepWorker.ts` re-checks each file against the sandbox itself before
 * reading it rather than trusting that filter blindly — so a bug in (or
 * future change to) the main-thread pre-filter, or a `/toggle-sandbox` state
 * change racing this call, doesn't turn into the worker reading a restricted
 * file just because it was handed the path.
 */
function scanInWorker(input: ScanInput, timeoutMs: number, signal?: AbortSignal): Promise<GrepResult> {
  return new Promise((resolve, reject) => {
    // Node.js 22.17.0+ and 23+ may support --experimental-strip-types natively, but it's a
    // build-time option. Try with the flag; if the worker fails to start, fall back to
    // running the scan on the main thread (without catastrophic-regex protection).
    const execArgv = ["--experimental-strip-types"];
    let worker: Worker | null = null;
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      fn();
    };

    const timer = setTimeout(() => {
      finish(() => {
        if (worker) worker.terminate();
        reject(
          new Error(
            `grep pattern "${input.pattern}" took longer than ${timeoutMs}ms to evaluate — it may be causing catastrophic backtracking; try a simpler pattern or narrow "glob"/"path"`
          )
        );
      });
    }, timeoutMs);

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
        execArgv,
      });

      worker.once("message", (msg: GrepResult | { error: string }) => {
        finish(() => {
          worker!.terminate();
          if ("error" in msg) reject(new Error(msg.error));
          else resolve(msg);
        });
      });

      worker.once("error", (err) => {
        // If the error is about TypeScript support, fall back to main-thread execution
        const errStr = (err as Error).message;
        if (errStr.includes("TypeScript") || errStr.includes("strip-types")) {
          clearTimeout(timer);
          signal?.removeEventListener("abort", onAbort);
          scanInMain(input, signal).then((result) => resolve(result)).catch((fallbackErr) => reject(fallbackErr));
        } else {
          finish(() => reject(err));
        }
      });
    } catch (err) {
      // Worker creation failed (e.g., no TS support) — fall back to main thread
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      scanInMain(input, signal).then((result) => resolve(result)).catch((fallbackErr) => reject(fallbackErr));
    }
  });
}

/**
 * Fallback: run the scan on the main thread. No catastrophic-regex protection,
 * but works on Node builds without --experimental-strip-types support.
 */
async function scanInMain(input: ScanInput, signal?: AbortSignal): Promise<GrepResult> {
  const { base, files, pattern, flags, max, context, sandboxState } = input;
  const regex = new RegExp(pattern, flags);

  const lines: GrepLine[] = [];
  let matchCount = 0;
  let filesScanned = 0;
  let truncated = false;

  const { isEntrySandboxSafe } = await import("../sandbox.ts");

  outer: for (const file of files) {
    if (signal?.aborted) throw new Error("Aborted");
    if (!isEntrySandboxSafe(base, file.path, "read", file.isSymlink, sandboxState)) continue;

    let content: string;
    try {
      content = await fs.readFile(path.join(base, file.path), "utf8");
    } catch {
      continue;
    }
    if (content.includes("\0")) continue;

    filesScanned++;
    const fileLines = content.split("\n");
    for (let i = 0; i < fileLines.length; i++) {
      if (signal?.aborted) throw new Error("Aborted");
      if (!regex.test(fileLines[i] ?? "")) continue;
      if (matchCount >= max) {
        truncated = true;
        break outer;
      }
      matchCount++;
      const from = Math.max(0, i - context);
      const to = Math.min(fileLines.length - 1, i + context);
      for (let j = from; j <= to; j++) {
        lines.push({ file: file.path, line: j + 1, text: fileLines[j] ?? "", isMatch: j === i });
      }
    }
  }

  return { lines, matchCount, filesScanned, truncated };
}

export function registerGrepTool(pi: ExtensionAPI) {
  pi.registerTool({
    ...GREP_TOOL_DEFINITION,
    renderCall(args, theme) {
      let text = `${callName(theme, "grep")} ${theme.fg("accent", `/${args.pattern ?? ""}/`)}`;
      text += theme.fg("toolOutput", ` in ${args.path ?? "."}`);
      if (args.glob) text += theme.fg("toolOutput", ` (${args.glob})`);
      if (args.ignoreCase) text += theme.fg("toolOutput", " -i");
      if (args.maxResults !== undefined) text += theme.fg("toolOutput", ` limit ${args.maxResults}`);
      return oneLine(text);
    },
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const base = resolveSandboxPath(ctx.cwd, params.path ?? ".", "read");
      const ignoreGlobs = await getEffectiveIgnoreGlobs(ctx.cwd, getAgentDir());
      const result = await grepFiles(base, params.pattern, {
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
