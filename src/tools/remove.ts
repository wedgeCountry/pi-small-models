import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { REMOVE_TOOL_DEFINITION } from "../tool_definitions/remove.ts";
import { resolveSafePath } from "../pathSafety.ts";
import { withFileMutationQueue } from "../mutationQueue.ts";

export interface RemoveOptions {
  recursive?: boolean;
  signal?: AbortSignal;
  /**
   * Absolute path to the project root. When set, `removePath` refuses to
   * delete a target that resolves to exactly this path — this is the guard
   * against an LLM call deleting the whole project, and living here (rather
   * than only in `execute()`) makes it exercisable by the plain-function
   * tests like every other safety check in this codebase.
   */
  projectRoot?: string;
}

/**
 * Recursively deletes `targetPath` entry by entry (rather than the single
 * `fs.rm({recursive: true})` call this used to be), checking `signal`
 * between each child so a runaway delete over a large directory tree can
 * actually be interrupted instead of running to completion unstoppably.
 * Node's `fs.rm`/`fs.mkdir` don't accept a `signal` option themselves, so
 * that check has to happen at this granularity to do anything useful.
 */
async function removeRecursively(targetPath: string, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  const stat = await fs.lstat(targetPath);
  if (stat.isDirectory()) {
    const names = await fs.readdir(targetPath);
    for (const name of names) {
      await removeRecursively(path.join(targetPath, name), signal);
    }
    await fs.rmdir(targetPath);
  } else {
    await fs.unlink(targetPath);
  }
}

/**
 * Deletes `targetPath`. Directories require `recursive: true`.
 *
 * The lstat-then-delete runs under `withFileMutationQueue` (keyed by `targetPath` itself, before
 * any children a recursive delete walks into) so a concurrent edit/write/insert/remove targeting
 * this exact path can't interleave with it — e.g. write to a file this call is about to delete,
 * only to have the write silently lost. This only locks the literal target path, not the whole
 * subtree underneath it, so a concurrent call targeting a path nested inside a directory being
 * recursively removed isn't blocked by this lock.
 */
export async function removePath(targetPath: string, opts: RemoveOptions = {}): Promise<void> {
  if (opts.projectRoot !== undefined && path.resolve(targetPath) === path.resolve(opts.projectRoot)) {
    throw new Error("Refusing to remove the project root");
  }

  await withFileMutationQueue(targetPath, async () => {
    let stat;
    try {
      stat = await fs.lstat(targetPath);
    } catch (err) {
      throw new Error(`Could not remove "${targetPath}": ${(err as Error).message}`);
    }

    if (stat.isDirectory() && !opts.recursive) {
      throw new Error(`"${targetPath}" is a directory; set recursive to true to remove it`);
    }

    opts.signal?.throwIfAborted();

    if (stat.isDirectory()) {
      await removeRecursively(targetPath, opts.signal);
    } else {
      await fs.unlink(targetPath);
    }
  });
}

export function registerRemoveTool(pi: ExtensionAPI) {
  pi.registerTool({
    ...REMOVE_TOOL_DEFINITION,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const targetPath = resolveSafePath(ctx.cwd, params.path);

      await removePath(targetPath, { recursive: params.recursive, signal, projectRoot: ctx.cwd });

      return {
        content: [{ type: "text", text: `Removed ${params.path}.` }],
        details: {},
      };
    },
  });
}
