import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { COPY_TOOL_DEFINITION } from "../tool_definitions/copy.ts";
import { resolveSandboxPath } from "../sandbox.ts";
import { withFileMutationQueue } from "../mutationQueue.ts";
import { oneLine, callName } from "../renderCall.ts";
import { withConciseValidationErrors } from "../toolValidation.ts";

export interface CopyOptions {
  recursive?: boolean;
  overwrite?: boolean;
  signal?: AbortSignal;
  /**
   * Sandbox root directory for path validation. When set, `copyFile` validates `sourcePath`
   * (read mode — it's only ever read here, never mutated) and `destPath` (edit mode) against the
   * sandbox's restricted-path rules (e.g. `.git/**`, `.ssh/**`, `.env*`). This makes the sandbox
   * check exercisable by plain-function tests, same as every other tool in this project.
   */
  sandboxRoot?: string;
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
 * Copies `sourcePath` to `destPath`, leaving `sourcePath` untouched. A directory source requires
 * `recursive: true`; an already-existing `destPath` requires `overwrite: true`. Missing parent
 * directories of `destPath` are created first, mirroring `writeFile`.
 *
 * Only `destPath` runs under `withFileMutationQueue` — `sourcePath` is never written to here, so
 * a concurrent edit/write/insert/remove racing against it is the same "not blocked" tradeoff the
 * other tools already accept for paths outside their literal target (see `remove.ts`).
 */
export async function copyFile(sourcePath: string, destPath: string, opts: CopyOptions = {}): Promise<void> {
  if (opts.sandboxRoot !== undefined) {
    resolveSandboxPath(opts.sandboxRoot, path.relative(opts.sandboxRoot, sourcePath), "read");
    resolveSandboxPath(opts.sandboxRoot, path.relative(opts.sandboxRoot, destPath), "edit");
  }

  if (path.resolve(sourcePath) === path.resolve(destPath)) {
    throw new Error("Source and destination are the same path");
  }

  opts.signal?.throwIfAborted();

  let sourceStat;
  try {
    sourceStat = await fs.lstat(sourcePath);
  } catch (err) {
    throw new Error(`Could not copy "${sourcePath}": ${(err as Error).message}`);
  }

  if (sourceStat.isDirectory() && !opts.recursive) {
    throw new Error(`"${sourcePath}" is a directory; set recursive to true to copy it`);
  }

  await withFileMutationQueue(destPath, async () => {
    opts.signal?.throwIfAborted();

    if (!opts.overwrite && (await pathExists(destPath))) {
      throw new Error(`"${destPath}" already exists; set overwrite to true to replace it`);
    }

    try {
      await fs.mkdir(path.dirname(destPath), { recursive: true });
    } catch (err) {
      throw new Error(`Could not create directory "${path.dirname(destPath)}": ${(err as Error).message}`);
    }

    // fs.cp doesn't accept a `signal` option (unlike fs.readFile/writeFile), so — same as
    // makeDir and removePath's non-recursive path — the best available is failing fast if
    // already aborted before starting; a large recursive copy can't be interrupted mid-flight.
    opts.signal?.throwIfAborted();

    try {
      // force:true is safe here — the overwrite check above already refused to reach this point
      // if destPath exists and overwrite wasn't set.
      await fs.cp(sourcePath, destPath, { recursive: true, force: true });
    } catch (err) {
      throw new Error(`Could not copy "${sourcePath}" to "${destPath}": ${(err as Error).message}`);
    }
  });
}

export function registerCopyTool(pi: ExtensionAPI) {
  pi.registerTool({
    ...COPY_TOOL_DEFINITION,
    prepareArguments: withConciseValidationErrors(COPY_TOOL_DEFINITION.name, COPY_TOOL_DEFINITION.parameters),
    renderCall(args, theme) {
      let text = `${callName(theme, "copy")} ${theme.fg("accent", args.path ?? "")} ${theme.fg(
        "toolOutput",
        "->"
      )} ${theme.fg("accent", args.destination ?? "")}`;
      if (args.recursive) text += theme.fg("toolOutput", " (recursive)");
      return oneLine(text);
    },
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const sourcePath = resolveSandboxPath(ctx.cwd, params.path, "read");
      const destPath = resolveSandboxPath(ctx.cwd, params.destination, "edit");

      await copyFile(sourcePath, destPath, { recursive: params.recursive, overwrite: params.overwrite, signal });

      return {
        content: [{ type: "text", text: `Copied ${params.path} to ${params.destination}.` }],
        details: {},
      };
    },
  });
}
