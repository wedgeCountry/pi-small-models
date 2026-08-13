import fg from "fast-glob";
import type {Readable} from "node:stream";
import {DEFAULT_IGNORE_GLOBS} from "../ignore.ts";
import type {ExtensionAPI} from "@earendil-works/pi-coding-agent";
import {FIND_TOOL_DEFINITION} from "../tool_definitions/find.ts";
import {resolveSandboxPath, isEntrySandboxSafe} from "../sandbox.ts";

export interface FindOptions {
  maxResults?: number;
  signal?: AbortSignal;
}

export interface FindResult {
  matches: string[];
  total: number;
  truncated: boolean;
}

/** Finds files/directories under `base` matching a glob pattern. */
export async function findFiles(base: string, pattern: string, opts: FindOptions = {}): Promise<FindResult> {
  const max = opts.maxResults ?? 200;
  opts.signal?.throwIfAborted();

  const entries = await streamGlob(base, pattern, opts.signal);
  // followSymbolicLinks: false only stops fast-glob from descending into a
  // symlinked directory — a symlinked entry itself still comes back in the
  // list, so re-check every entry against the sandbox (restricted globs
  // apply regardless of symlink status; the symlink-escape check only needs
  // to run for entries actually flagged as symlinks) before disclosing them.
  const matches = entries
    .filter((e) => isEntrySandboxSafe(base, e.path, "read", e.dirent.isSymbolicLink()))
    .map((e) => e.path)
    .sort();
  const truncated = matches.length > max;
  return { matches: matches.slice(0, max), total: matches.length, truncated };
}

/**
 * Runs fast-glob via its stream API rather than the plain promise-returning
 * `fg()` call, so a scan over a huge/unfiltered tree can actually be
 * interrupted mid-flight by `signal` — destroying the stream stops fast-glob
 * from scheduling further directory reads, something the promise API (a
 * single un-cancellable await) has no way to do.
 */
function streamGlob(base: string, pattern: string, signal?: AbortSignal): Promise<fg.Entry[]> {
  return new Promise((resolve, reject) => {
    // fast-glob types `stream()` as the generic `NodeJS.ReadableStream`
    // (no `.destroy()`), but the object it actually returns is a real
    // `stream.Readable` — cast so aborting can call `.destroy()` on it.
    const stream = fg.stream(pattern, {
      cwd: base,
      ignore: DEFAULT_IGNORE_GLOBS,
      onlyFiles: false,
      dot: false,
      followSymbolicLinks: false,
      objectMode: true,
    }) as unknown as Readable;

    const entries: fg.Entry[] = [];
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      fn();
    };

    const onAbort = () => {
      finish(() => {
        stream.removeAllListeners();
        stream.destroy();
        reject(new Error(`find over "${pattern}" was aborted`));
      });
    };

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }

    stream.on("data", (entry: fg.Entry) => entries.push(entry));
    stream.once("end", () => finish(() => resolve(entries)));
    stream.once("error", (err: Error) => finish(() => reject(err)));
  });
}

export function registerFindTool(pi: ExtensionAPI) {
  pi.registerTool({
    ...FIND_TOOL_DEFINITION,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const base = resolveSandboxPath(ctx.cwd, params.path ?? ".", "read");
      const result = await findFiles(base, params.pattern, {maxResults: params.maxResults, signal});

      const text = result.matches.length
          ? result.matches.join("\n") +
          (result.truncated ? `\n… ${result.total - result.matches.length} more result(s) truncated` : "")
          : "No files matched.";

      return {
        content: [{type: "text", text}],
        details: result,
      };
    },
  });
}
