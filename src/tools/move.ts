import * as fs from "node:fs/promises";
import * as path from "node:path";
import { MOVE_TOOL_DEFINITION } from "../tool_definitions/move.ts";
import type { ToolRegistry } from "../sandbox/permissionGate.ts";
import { sandboxFor, type Sandbox } from "../sandbox/sandbox.ts";
import { withFileMutationQueue } from "../mutationQueue.ts";
import { removeRecursively } from "./remove.ts";
import { oneLine, callName } from "../renderCall.ts";
import { withConciseValidationErrors } from "../toolValidation.ts";

export interface MoveOptions {
  recursive?: boolean;
  overwrite?: boolean;
  signal?: AbortSignal;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.lstat(targetPath);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

/**
 * Moves (renames) `source` to `destination`, both resolved through `sb`. The project root itself is
 * never moved, mirroring `remove`'s guard. A directory source requires `recursive: true`; an
 * already-existing `destPath` requires `overwrite: true` (and is deleted via `removeRecursively`
 * before the move, so the rename always lands on a clean target regardless of either side's
 * file/directory type). Missing parent directories of `destPath` are created first, mirroring
 * `writeFile`.
 *
 * Tries `fs.rename` first (atomic, but same-filesystem only); on `EXDEV` (source and destination
 * are on different filesystems/devices) falls back to `fs.cp` followed by removing the source.
 *
 * Both `sourcePath` and `destPath` run under `withFileMutationQueue`, locked in the same
 * lexically-sorted order regardless of which call is "move A to B" vs. "move B to A" — otherwise
 * two moves swapping the same two paths could each acquire one lock and wait forever on the
 * other (classic AB-BA deadlock). Locking the same path twice (sourcePath === destPath) would hit
 * the same deadlock from a single call, which is why that case is rejected up front instead.
 */
export async function moveFile(sb: Sandbox, source: string, destination: string, opts: MoveOptions = {}): Promise<void> {
  const sourcePath = sb.resolve(source);
  const destPath = sb.resolve(destination);
  if (sourcePath === sb.root) {
    throw new Error("Refusing to move the project root");
  }

  if (path.resolve(sourcePath) === path.resolve(destPath)) {
    throw new Error("Source and destination are the same path");
  }

  const sortedPaths = [sourcePath, destPath].sort();
  const first = sortedPaths[0]!;
  const second = sortedPaths[1]!;

  await withFileMutationQueue(first, () =>
    withFileMutationQueue(second, async () => {
      opts.signal?.throwIfAborted();

      let sourceStat;
      try {
        sourceStat = await fs.lstat(sourcePath);
      } catch (err) {
        throw new Error(`Could not move "${sourcePath}": ${(err as Error).message}`);
      }

      if (sourceStat.isDirectory() && !opts.recursive) {
        throw new Error(`"${sourcePath}" is a directory; set recursive to true to move it`);
      }

      const destExists = await pathExists(destPath);
      if (destExists && !opts.overwrite) {
        throw new Error(`"${destPath}" already exists; set overwrite to true to replace it`);
      }

      try {
        await fs.mkdir(path.dirname(destPath), { recursive: true });
      } catch (err) {
        throw new Error(`Could not create directory "${path.dirname(destPath)}": ${(err as Error).message}`);
      }

      if (destExists) {
        await removeRecursively(destPath, opts.signal);
      }

      try {
        await fs.rename(sourcePath, destPath);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EXDEV") {
          throw new Error(`Could not move "${sourcePath}" to "${destPath}": ${(err as Error).message}`);
        }
        // fs.cp doesn't accept a `signal` option, so the EXDEV fallback's copy step can't be
        // interrupted mid-flight; removeRecursively's own signal checks still apply to deleting
        // the source afterward.
        try {
          await fs.cp(sourcePath, destPath, { recursive: true, force: true });
          await removeRecursively(sourcePath, opts.signal);
        } catch (fallbackErr) {
          if ((fallbackErr as NodeJS.ErrnoException).name === "AbortError") throw fallbackErr;
          throw new Error(`Could not move "${sourcePath}" to "${destPath}": ${(fallbackErr as Error).message}`);
        }
      }
    })
  );
}

export function registerMoveTool(pi: ToolRegistry) {
  pi.registerTool({
    ...MOVE_TOOL_DEFINITION,
    prepareArguments: withConciseValidationErrors(MOVE_TOOL_DEFINITION.name, MOVE_TOOL_DEFINITION.parameters),
    renderCall(args, theme) {
      let text = `${callName(theme, "move")} ${theme.fg("accent", args.path ?? "")} ${theme.fg(
        "toolOutput",
        "->"
      )} ${theme.fg("accent", args.destination ?? "")}`;
      if (args.recursive) text += theme.fg("toolOutput", " (recursive)");
      return oneLine(text);
    },
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      await moveFile(sandboxFor(ctx.cwd), params.path, params.destination, {
        recursive: params.recursive,
        overwrite: params.overwrite,
        signal,
      });

      return {
        content: [{ type: "text", text: `Moved ${params.path} to ${params.destination}.` }],
        details: {},
      };
    },
  });
}
