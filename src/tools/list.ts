import * as fs from "node:fs/promises";
import * as path from "node:path";
import micromatch from "micromatch";
import { DEFAULT_IGNORE_NAMES, getEffectiveIgnoreGlobs } from "../ignore.ts";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { LIST_TOOL_DEFINITION } from "../tool_definitions/list.ts";
import { resolveSandboxPath, isEntrySandboxSafe } from "../sandbox.ts";
import { oneLine, callName } from "../renderCall.ts";

export interface ListOptions {
  recursive?: boolean;
  maxDepth?: number;
  showHidden?: boolean;
  maxResults?: number;
  signal?: AbortSignal;
  /**
   * Additional glob patterns (matched against each entry's path relative to `base`, POSIX-style,
   * via micromatch) to skip on top of `DEFAULT_IGNORE_NAMES`. Pass `getEffectiveIgnoreGlobs()`'s
   * result to also honor `/ignore`'s global and local ignore files. Unlike `DEFAULT_IGNORE_NAMES`
   * (bare directory names, checked before recursing), these are full globs — same matching engine
   * fast-glob (used by `find`/`grep`) relies on internally, so a trailing-`/**` pattern like the
   * ones in `DEFAULT_IGNORE_GLOBS` matches the directory itself as well as its contents, excluding
   * it from the listing entirely rather than leaving an empty-looking directory entry behind.
   */
  ignoreGlobs?: string[];
}

export interface ListEntry {
  path: string; // relative to the listed base dir, e.g. "src/index.ts"
  isDirectory: boolean;
}

export interface ListResult {
  entries: ListEntry[];
  total: number;
  truncated: boolean;
}

/** Lists directory entries under `base`, optionally recursively. */
export async function listDir(base: string, opts: ListOptions = {}): Promise<ListResult> {
  const maxDepth = opts.recursive ? (opts.maxDepth ?? 3) : 0;
  const max = opts.maxResults ?? 200;
  const entries: ListEntry[] = [];

  async function walk(dir: string, relPrefix: string, depth: number): Promise<void> {
    if (opts.signal?.aborted) throw new Error("Aborted");
    const dirents = await fs.readdir(dir, { withFileTypes: true });
    const filtered = dirents
      .filter((d) => opts.showHidden || !d.name.startsWith("."))
      .filter((d) => !DEFAULT_IGNORE_NAMES.has(d.name))
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const dirent of filtered) {
      const relPath = relPrefix ? `${relPrefix}/${dirent.name}` : dirent.name;
      // A symlink inside base can point outside it even though base itself
      // is safe, and a real (non-symlinked) entry can still fall under a
      // restricted path (e.g. .ssh) — skip (don't even disclose the name
      // of) anything the sandbox rejects.
      if (!isEntrySandboxSafe(base, relPath, "read", dirent.isSymbolicLink())) continue;
      if (opts.ignoreGlobs && micromatch.isMatch(relPath, opts.ignoreGlobs, { dot: true })) continue;
      const isDirectory = dirent.isDirectory();
      entries.push({ path: relPath, isDirectory });
      if (isDirectory && depth < maxDepth) {
        await walk(path.join(dir, dirent.name), relPath, depth + 1);
      }
    }
  }

  await walk(base, "", 0);
  const truncated = entries.length > max;
  return { entries: entries.slice(0, max), total: entries.length, truncated };
}

export function registerListTool(pi: ExtensionAPI) {
  pi.registerTool({
    ...LIST_TOOL_DEFINITION,
    renderCall(args, theme) {
      let text = `${callName(theme, "list")} ${theme.fg("accent", args.path ?? ".")}`;
      if (args.recursive) text += theme.fg("toolOutput", ` (recursive, depth ${args.maxDepth ?? 3})`);
      return oneLine(text);
    },
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const base = resolveSandboxPath(ctx.cwd, params.path ?? ".", "read");
      const ignoreGlobs = await getEffectiveIgnoreGlobs(ctx.cwd, getAgentDir());
      const result = await listDir(base, {
        recursive: params.recursive,
        maxDepth: params.maxDepth,
        showHidden: params.showHidden,
        maxResults: params.maxResults,
        signal,
        ignoreGlobs,
      });

      const remaining = result.total - result.entries.length;
      const text = result.entries.length
        ? result.entries.map((e) => (e.isDirectory ? `${e.path}/` : e.path)).join("\n") +
          (result.truncated ? `\n… ${remaining} more entr${remaining === 1 ? "y" : "ies"} truncated` : "")
        : "(empty directory)";

      return {
        content: [{ type: "text", text }],
        details: result,
      };
    },
  });
}
