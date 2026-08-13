import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { GIT_STATUS_TOOL_DEFINITION } from "../tool_definitions/git_status.ts";
import { resolveSandboxPath, isEntrySandboxSafe } from "../sandbox.ts";

const execFile = promisify(execFileCb);

// Generous relative to how large `git status --porcelain` output actually gets (one short line per
// changed file) — this is a ceiling to stop a pathological repo from blowing past Node's default
// 1MB stdout buffer, not a cap we expect to normally approach.
const MAX_BUFFER = 5 * 1024 * 1024; // 5MB

export interface GitStatusEntry {
  path: string;
  /** Single-character status code for the index (staged) side of `git status --porcelain=v1`. */
  indexStatus: string;
  /** Single-character status code for the worktree (unstaged) side. */
  worktreeStatus: string;
  /** Set for renames/copies: the path this entry was renamed/copied from. */
  renamedFrom?: string;
}

export interface GitStatusOptions {
  /** Path (relative to `cwd`) to scope the status to. Omit for the whole repository. */
  path?: string;
  signal?: AbortSignal;
}

export interface GitStatusResult {
  branch: string | null;
  ahead: number;
  behind: number;
  entries: GitStatusEntry[];
}

/**
 * Runs `git status --porcelain=v1 --branch` in `cwd` and parses it into a branch/ahead/behind
 * summary plus a list of changed entries. `--porcelain=v1` is used instead of `--short` because
 * git guarantees the porcelain format is stable across versions, unlike `--short`'s human-facing
 * output.
 */
export async function gitStatus(cwd: string, opts: GitStatusOptions = {}): Promise<GitStatusResult> {
  const args = ["status", "--porcelain=v1", "--branch"];
  if (opts.path) args.push("--", opts.path);

  let stdout: string;
  try {
    ({ stdout } = await execFile("git", args, { cwd, signal: opts.signal, maxBuffer: MAX_BUFFER }));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).name === "AbortError") throw err;
    throw new Error(`git status failed: ${describeError(err)}`);
  }

  let branch: string | null = null;
  let ahead = 0;
  let behind = 0;
  const entries: GitStatusEntry[] = [];

  for (const line of stdout.split(/\r\n|\n/)) {
    if (line === "") continue;

    if (line.startsWith("## ")) {
      // e.g. "## main...origin/main [ahead 1, behind 2]" or "## HEAD (no branch)"
      const header = line.slice(3);
      const aheadMatch = header.match(/ahead (\d+)/);
      const behindMatch = header.match(/behind (\d+)/);
      if (aheadMatch) ahead = Number(aheadMatch[1]);
      if (behindMatch) behind = Number(behindMatch[1]);
      const name = header.split(/\.\.\.| \[/)[0];
      branch = name || null;
      continue;
    }

    const indexStatus = line[0] ?? " ";
    const worktreeStatus = line[1] ?? " ";
    let rest = line.slice(3);
    let renamedFrom: string | undefined;
    const arrow = rest.indexOf(" -> ");
    if (arrow !== -1) {
      renamedFrom = rest.slice(0, arrow);
      rest = rest.slice(arrow + 4);
    }
    entries.push({ path: rest, indexStatus, worktreeStatus, renamedFrom });
  }

  // `git status` reports every changed path in the repo regardless of `opts.path` scoping (and
  // even when unscoped entirely, the tool's default) — unlike `find`/`grep`/`list`, which only ever
  // walk filesystem entries that already passed `isEntrySandboxSafe`, nothing here has filtered a
  // credential-shaped path (`.env`, `.ssh/**`, ...) out yet. Do that now, the same way those tools
  // do, rather than disclosing that such a file exists (or was renamed/staged) just because git
  // already knows about it. `isSymlink: false` throughout: git only ever reports a path relative to
  // the repo's own working tree, never one resolved through a symlink to somewhere else, so the
  // symlink-escape half of `isEntrySandboxSafe` doesn't apply here — only the restricted-glob check
  // does.
  const visibleEntries = entries.filter(
    (e) =>
      isEntrySandboxSafe(cwd, e.path, "read", false) &&
      (e.renamedFrom === undefined || isEntrySandboxSafe(cwd, e.renamedFrom, "read", false))
  );

  return { branch, ahead, behind, entries: visibleEntries };
}

function describeError(err: unknown): string {
  const e = err as NodeJS.ErrnoException & { stderr?: string };
  if (e.code === "ENOENT") return "git is not installed or not on PATH";
  return e.stderr?.trim() || e.message || String(err);
}

export function registerGitStatusTool(pi: ExtensionAPI) {
  pi.registerTool({
    ...GIT_STATUS_TOOL_DEFINITION,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      let relPath: string | undefined;
      if (params.path) {
        const resolved = resolveSandboxPath(ctx.cwd, params.path, "read");
        const rel = path.relative(ctx.cwd, resolved);
        relPath = rel === "" ? undefined : rel;
      }

      const result = await gitStatus(ctx.cwd, { path: relPath, signal });

      const branchLine = result.branch
        ? `On branch ${result.branch}` +
          (result.ahead ? `, ahead ${result.ahead}` : "") +
          (result.behind ? `, behind ${result.behind}` : "")
        : "Not on any branch";
      const entryLines = result.entries.length
        ? result.entries.map(
            (e) => `${e.indexStatus}${e.worktreeStatus} ${e.renamedFrom ? `${e.renamedFrom} -> ` : ""}${e.path}`
          )
        : ["(clean — no changes)"];

      return {
        content: [{ type: "text", text: [branchLine, ...entryLines].join("\n") }],
        details: { branch: result.branch, ahead: result.ahead, behind: result.behind, entries: result.entries },
      };
    },
  });
}
