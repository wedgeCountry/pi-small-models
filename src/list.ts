import * as fs from "node:fs/promises";
import * as path from "node:path";
import { DEFAULT_IGNORE_NAMES } from "./ignore.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { LIST_TOOL_DEFINITION } from "../tool_definitions/list.ts";
import { resolveSafePath } from "./pathSafety.ts";

export interface ListOptions {
  recursive?: boolean;
  maxDepth?: number;
  showHidden?: boolean;
  signal?: AbortSignal;
}

export interface ListEntry {
  path: string; // relative to the listed base dir, e.g. "src/index.ts"
  isDirectory: boolean;
}

/** Lists directory entries under `base`, optionally recursively. */
export async function listDir(base: string, opts: ListOptions = {}): Promise<ListEntry[]> {
  const maxDepth = opts.recursive ? (opts.maxDepth ?? 3) : 0;
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
      const isDirectory = dirent.isDirectory();
      entries.push({ path: relPath, isDirectory });
      if (isDirectory && depth < maxDepth) {
        await walk(path.join(dir, dirent.name), relPath, depth + 1);
      }
    }
  }

  await walk(base, "", 0);
  return entries;
}

export function registerListTool(pi: ExtensionAPI) {
  pi.registerTool({
    ...LIST_TOOL_DEFINITION,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const base = resolveSafePath(ctx.cwd, params.path ?? ".");
      const entries = await listDir(base, {
        recursive: params.recursive,
        maxDepth: params.maxDepth,
        showHidden: params.showHidden,
        signal,
      });

      const text = entries.length
        ? entries.map((e) => (e.isDirectory ? `${e.path}/` : e.path)).join("\n")
        : "(empty directory)";

      return {
        content: [{ type: "text", text }],
        details: { entries },
      };
    },
  });
}
