import * as fs from "node:fs/promises";
import * as path from "node:path";
import micromatch from "micromatch";
import { DEFAULT_IGNORE_NAMES, getEffectiveIgnoreGlobs } from "../ignore.ts";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { LIST_TOOL_DEFINITION } from "../tool_definitions/list.ts";
import type { ToolRegistry } from "../sandbox/permissionGate.ts";
import { sandboxFor, type Sandbox } from "../sandbox/sandbox.ts";
import { oneLine, callName } from "../renderCall.ts";
import { withConciseValidationErrors } from "../toolValidation.ts";

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

/** Lists directory entries under `target` (resolved through `sb`), optionally recursively. */
export async function listDir(sb: Sandbox, target: string, opts: ListOptions = {}): Promise<ListResult> {
  const base = sb.resolve(target);
  const allowed = sb.entryFilter(base);
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
      // Skip (don't even disclose the name of) anything the sandbox rejects: a protected entry such
      // as .ssh, or a symlink pointing outside the project.
      if (!allowed(relPath, dirent.isSymbolicLink())) continue;
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

export function registerListTool(pi: ToolRegistry) {
  pi.registerTool({
    ...LIST_TOOL_DEFINITION,
    prepareArguments: withConciseValidationErrors(LIST_TOOL_DEFINITION.name, LIST_TOOL_DEFINITION.parameters),
    renderCall(args, theme) {
      let text = `${callName(theme, "list")} ${theme.fg("accent", args.path ?? ".")}`;
      if (args.recursive) text += theme.fg("toolOutput", ` (recursive, depth ${args.maxDepth ?? 3})`);
      return oneLine(text);
    },
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const ignoreGlobs = await getEffectiveIgnoreGlobs(ctx.cwd, getAgentDir());
      const result = await listDir(sandboxFor(ctx.cwd), params.path ?? ".", {
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
