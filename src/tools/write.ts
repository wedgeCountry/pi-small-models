import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { WRITE_TOOL_DEFINITION } from "../tool_definitions/write.ts";
import { resolveSafePath } from "../pathSafety.ts";
import { withFileMutationQueue } from "../mutationQueue.ts";

export interface WriteOptions {
  signal?: AbortSignal;
}

/**
 * Writes `content` to `filePath`, creating the file if it doesn't exist and overwriting it if it
 * does. Missing parent directories are created first, mirroring Pi's built-in write tool.
 *
 * `fs.mkdir` doesn't accept a `signal` option (unlike `fs.readFile`/`writeFile`), so — same as
 * `makeDir` — the best we can do is fail fast if already aborted before starting.
 *
 * Runs under `withFileMutationQueue` so a `write` racing an `edit`/`insert`/`remove` on the same
 * path can't interleave with it.
 */
export async function writeFile(filePath: string, content: string, opts: WriteOptions = {}): Promise<void> {
  await withFileMutationQueue(filePath, async () => {
    opts.signal?.throwIfAborted();

    const dir = path.dirname(filePath);
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (err) {
      throw new Error(`Could not create directory "${dir}": ${(err as Error).message}`);
    }

    opts.signal?.throwIfAborted();
    try {
      // fs.writeFile natively honors `signal`, unlike fs.rm/fs.mkdir — no manual abort plumbing
      // needed here.
      await fs.writeFile(filePath, content, { encoding: "utf8", signal: opts.signal });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).name === "AbortError") throw err;
      throw new Error(`Could not write file "${filePath}": ${(err as Error).message}`);
    }
  });
}

export function registerWriteTool(pi: ExtensionAPI) {
  pi.registerTool({
    ...WRITE_TOOL_DEFINITION,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const filePath = resolveSafePath(ctx.cwd, params.path);
      await writeFile(filePath, params.content, { signal });

      return {
        content: [{ type: "text", text: `Successfully wrote ${params.content.length} bytes to ${params.path}.` }],
        details: {},
      };
    },
  });
}
