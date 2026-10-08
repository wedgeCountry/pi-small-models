import * as fs from "node:fs/promises";
import * as path from "node:path";
import { REMOVE_TOOL_DEFINITION } from "../tool_definitions/remove.ts";
import type { ToolRegistry } from "../sandbox/permissionGate.ts";
import { sandboxFor, type Sandbox } from "../sandbox/sandbox.ts";
import { withFileMutationQueue } from "../mutationQueue.ts";
import { oneLine, callName } from "../renderCall.ts";
import { withConciseValidationErrors } from "../toolValidation.ts";

export interface RemoveOptions {
  recursive?: boolean;
  signal?: AbortSignal;
}

/**
 * Recursively deletes `targetPath` entry by entry (rather than the single
 * `fs.rm({recursive: true})` call this used to be), checking `signal`
 * between each child so a runaway delete over a large directory tree can
 * actually be interrupted instead of running to completion unstoppably.
 * Node's `fs.rm`/`fs.mkdir` don't accept a `signal` option themselves, so
 * that check has to happen at this granularity to do anything useful.
 *
 * Exported so `move.ts` can reuse it for deleting an overwritten destination
 * and for the source side of its cross-device (`EXDEV`) rename fallback,
 * rather than duplicating this walk. It stats `targetPath` itself, so a
 * caller never needs to branch on file-vs-directory before calling it.
 */
export async function removeRecursively(targetPath: string, signal?: AbortSignal): Promise<void> {
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
 * Deletes `target` (resolved through `sb`). Directories require `recursive: true`, and the project
 * root itself is never removed.
 *
 * The lstat-then-delete runs under `withFileMutationQueue` (keyed by `targetPath` itself, before
 * any children a recursive delete walks into) so a concurrent edit/write/insert/remove targeting
 * this exact path can't interleave with it — e.g. write to a file this call is about to delete,
 * only to have the write silently lost. This only locks the literal target path, not the whole
 * subtree underneath it, so a concurrent call targeting a path nested inside a directory being
 * recursively removed isn't blocked by this lock.
 */
export async function removePath(sb: Sandbox, target: string, opts: RemoveOptions = {}): Promise<void> {
  const targetPath = sb.resolve(target);
  if (targetPath === sb.root) {
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

export function registerRemoveTool(pi: ToolRegistry) {
  pi.registerTool({
    ...REMOVE_TOOL_DEFINITION,
    prepareArguments: withConciseValidationErrors(REMOVE_TOOL_DEFINITION.name, REMOVE_TOOL_DEFINITION.parameters),
    renderCall(args, theme) {
      let text = `${callName(theme, "remove")} ${theme.fg("accent", args.path ?? "")}`;
      if (args.recursive) text += theme.fg("toolOutput", " (recursive)");
      return oneLine(text);
    },
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      await removePath(sandboxFor(ctx.cwd), params.path, { recursive: params.recursive, signal });

      return {
        content: [{ type: "text", text: `Removed ${params.path}.` }],
        details: {},
      };
    },
  });
}
