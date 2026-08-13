import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { GIT_DIFF_TOOL_DEFINITION } from "../tool_definitions/git_diff.ts";
import { resolveSandboxPath } from "../sandbox.ts";

const execFile = promisify(execFileCb);

// Ceiling on raw git output before our own line/byte truncation (below) applies — generous enough
// that a large but reasonable diff isn't rejected outright by Node's stdout buffering.
const MAX_BUFFER = 20 * 1024 * 1024; // 20MB

// Same caps as `read`'s DEFAULT_MAX_LINES/DEFAULT_MAX_BYTES, applied here for the same reason: one
// call shouldn't be able to flood a small model's context with an enormous diff.
const DEFAULT_MAX_LINES = 2000;
const DEFAULT_MAX_BYTES = 50 * 1024; // 50KB

export interface GitDiffOptions {
  /** Path (relative to `cwd`) to scope the diff to. Omit for the whole repository. */
  path?: string;
  /** Show staged changes (`git diff --cached`) instead of unstaged changes. */
  staged?: boolean;
  signal?: AbortSignal;
}

export interface GitDiffResult {
  text: string;
  truncated: boolean;
}

/**
 * Runs `git diff` (or `git diff --cached` when `staged`) in `cwd` and returns the unified diff
 * text, capped at DEFAULT_MAX_LINES lines / DEFAULT_MAX_BYTES bytes (whichever is hit first) — the
 * same shape of cap `readFile` applies to file contents.
 */
export async function gitDiff(cwd: string, opts: GitDiffOptions = {}): Promise<GitDiffResult> {
  const args = ["diff"];
  if (opts.staged) args.push("--cached");
  if (opts.path) args.push("--", opts.path);

  let stdout: string;
  try {
    ({ stdout } = await execFile("git", args, { cwd, signal: opts.signal, maxBuffer: MAX_BUFFER }));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).name === "AbortError") throw err;
    throw new Error(`git diff failed: ${describeError(err)}`);
  }

  if (stdout === "") return { text: "", truncated: false };

  const allLines = stdout.split(/\r\n|\n/);
  let selected = allLines.slice(0, Math.min(allLines.length, DEFAULT_MAX_LINES));
  while (selected.length > 1 && Buffer.byteLength(selected.join("\n"), "utf8") > DEFAULT_MAX_BYTES) {
    selected = selected.slice(0, -1);
  }

  return { text: selected.join("\n"), truncated: selected.length < allLines.length };
}

function describeError(err: unknown): string {
  const e = err as NodeJS.ErrnoException & { stderr?: string };
  if (e.code === "ENOENT") return "git is not installed or not on PATH";
  return e.stderr?.trim() || e.message || String(err);
}

export function registerGitDiffTool(pi: ExtensionAPI) {
  pi.registerTool({
    ...GIT_DIFF_TOOL_DEFINITION,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      let relPath: string | undefined;
      if (params.path) {
        const resolved = resolveSandboxPath(ctx.cwd, params.path, "read");
        const rel = path.relative(ctx.cwd, resolved);
        relPath = rel === "" ? undefined : rel;
      }

      const result = await gitDiff(ctx.cwd, { path: relPath, staged: params.staged, signal });

      let text = result.text || "No changes.";
      if (result.truncated) {
        text += `\n\n[Diff truncated. Narrow with path to see less at once, e.g. { path: "<subdirectory>" }.]`;
      }

      return {
        content: [{ type: "text", text }],
        details: { truncated: result.truncated },
      };
    },
  });
}
