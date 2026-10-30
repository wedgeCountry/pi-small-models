import * as fs from "node:fs/promises";
import * as path from "node:path";
import { WRITE_TOOL_DEFINITION } from "../tool_definitions/write.ts";
import type { ToolRegistry } from "../sandbox/permissionGate.ts";
import { sandboxFor, type Sandbox } from "../sandbox/sandbox.ts";
import { withFileMutationQueue } from "../backend/mutationQueue.ts";
import { renderLine } from "../backend/renderCall.ts";
import { createTool } from "../backend/createTool.ts";
import { toolError } from "../backend/formatError.ts";

export interface WriteOptions {
  signal?: AbortSignal;
}

/**
 * Writes `content` to `target` (resolved through `sb`), creating the file if it doesn't exist and overwriting it if it
 * does. Missing parent directories are created first, mirroring Pi's built-in write tool.
 *
 * `fs.mkdir` doesn't accept a `signal` option (unlike `fs.readFile`/`writeFile`), so — same as
 * `makeDir` — the best we can do is fail fast if already aborted before starting.
 *
 * Runs under `withFileMutationQueue` so a `write` racing an `edit`/`insert`/`remove` on the same
 * path can't interleave with it.
 */
export async function writeFile(sb: Sandbox, target: string, content: string, opts: WriteOptions = {}): Promise<void> {
  const filePath = sb.resolve(target);
  await withFileMutationQueue(filePath, async () => {
    opts.signal?.throwIfAborted();

    const dir = path.dirname(filePath);
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (err) {
      throw toolError("write", `Could not create directory "${dir}": ${(err as Error).message}`, { path: target });
    }

    opts.signal?.throwIfAborted();
    try {
      // fs.writeFile natively honors `signal`, unlike fs.rm/fs.mkdir — no manual abort plumbing
      // needed here.
      await fs.writeFile(filePath, content, { encoding: "utf8", signal: opts.signal });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).name === "AbortError") throw err;
      throw toolError("write", `Could not write file "${filePath}": ${(err as Error).message}`, { path: target });
    }
  });
}

export function registerWriteTool(pi: ToolRegistry) {
  pi.registerTool(
    createTool(WRITE_TOOL_DEFINITION, {
      renderCall: (args, theme) =>
        renderLine(theme, "write", args.path, args.content !== undefined ? ` (${args.content.length} bytes)` : undefined),
      async execute(params, { signal, cwd }) {
        await writeFile(sandboxFor(cwd), params.path, params.content, { signal });

        return {
          content: [{ type: "text", text: `Successfully wrote ${params.content.length} bytes to ${params.path}.` }],
          details: {},
        };
      },
    })
  );
}
