import * as fs from "node:fs/promises";
import * as path from "node:path";
import { COPY_TOOL_DEFINITION } from "../tool_definitions/copy.ts";
import type { ToolRegistry } from "../sandbox/permissionGate.ts";
import { SandboxError, sandboxFor, type Sandbox } from "../sandbox/sandbox.ts";
import { withFileMutationQueue } from "../backend/mutationQueue.ts";
import { renderLine } from "../backend/renderCall.ts";
import { createTool } from "../backend/createTool.ts";
import { toolError } from "../backend/formatError.ts";

export interface CopyOptions {
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
 * Copies `source` to `destination` (both resolved through `sb`), leaving `sourcePath` untouched. A directory source requires
 * `recursive: true`; an already-existing `destPath` requires `overwrite: true`. Missing parent
 * directories of `destPath` are created first, mirroring `writeFile`.
 *
 * Only `destPath` runs under `withFileMutationQueue` — `sourcePath` is never written to here, so
 * a concurrent edit/write/insert/remove racing against it is the same "not blocked" tradeoff the
 * other tools already accept for paths outside their literal target (see `remove.ts`).
 */
export async function copyFile(sb: Sandbox, source: string, destination: string, opts: CopyOptions = {}): Promise<void> {
  const sourcePath = sb.resolve(source);
  const destPath = sb.resolve(destination);

  if (path.resolve(sourcePath) === path.resolve(destPath)) {
    throw toolError("copy", "Source and destination are the same path", { path: source, destination });
  }

  opts.signal?.throwIfAborted();

  let sourceStat;
  try {
    sourceStat = await fs.lstat(sourcePath);
  } catch (err) {
    throw toolError("copy", `Could not copy "${sourcePath}": ${(err as Error).message}`, { path: source, destination, recursive: opts.recursive });
  }

  if (sourceStat.isDirectory() && !opts.recursive) {
    throw toolError("copy", `"${sourcePath}" is a directory; set recursive to true to copy it`, { path: source, destination, recursive: opts.recursive });
  }

  // Check if copying a directory would expose restricted files
  if (sourceStat.isDirectory() && opts.recursive) {
    const hasRestricted = await sb.hasRestrictedDescendant(sourcePath);
    if (hasRestricted) {
      throw new SandboxError("restricted", `Cannot copy "${source}": directory contains restricted files that would be exposed`);
    }
  }

  await withFileMutationQueue(destPath, async () => {
    opts.signal?.throwIfAborted();

    if (!opts.overwrite && (await pathExists(destPath))) {
      throw toolError("copy", `"${destPath}" already exists; set overwrite to true to replace it`, { path: source, destination, overwrite: opts.overwrite });
    }

    try {
      await fs.mkdir(path.dirname(destPath), { recursive: true });
    } catch (err) {
      throw toolError("copy", `Could not create directory "${path.dirname(destPath)}": ${(err as Error).message}`, { path: source, destination });
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
      throw toolError("copy", `Could not copy "${sourcePath}" to "${destPath}": ${(err as Error).message}`, { path: source, destination, recursive: opts.recursive, overwrite: opts.overwrite });
    }
  });
}

export function registerCopyTool(pi: ToolRegistry) {
  pi.registerTool(
    createTool(COPY_TOOL_DEFINITION, {
      renderCall: (args, theme) =>
        renderLine(theme, "copy", args.path, "->", args.destination, args.recursive ? " (recursive)" : undefined),
      async execute(params, { signal, cwd }) {
        await copyFile(sandboxFor(cwd), params.path, params.destination, { recursive: params.recursive, overwrite: params.overwrite, signal });

        return {
          content: [{ type: "text", text: `Copied ${params.path} to ${params.destination}.` }],
          details: {},
        };
      },
    })
  );
}
