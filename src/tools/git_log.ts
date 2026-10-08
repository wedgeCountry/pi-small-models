import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { GIT_LOG_TOOL_DEFINITION } from "../tool_definitions/git_log.ts";
import type { ToolRegistry } from "../sandbox/permissionGate.ts";
import { sandboxFor, type Sandbox } from "../sandbox/sandbox.ts";
import { oneLine, callName } from "../renderCall.ts";
import { withConciseValidationErrors } from "../toolValidation.ts";

const execFile = promisify(execFileCb);

const MAX_BUFFER = 20 * 1024 * 1024; // 20MB
const DEFAULT_MAX_COUNT = 1;
const MAX_COUNT_CEILING = 50;

export interface GitLogOptions {
  /** Number of commits to return. Defaults to 10, clamped to 1..50. */
  maxCount?: number;
  /** Path (relative to `cwd`) to scope the log to. Omit for the whole repository. */
  path?: string;
  signal?: AbortSignal;
}

export interface GitLogCommit {
  hash: string;
  author: string;
  date: string;
  subject: string;
  /** Files changed by the commit, minus any matching the sandbox's read-restricted globs. */
  files: string[];
}

export interface GitLogResult {
  commits: GitLogCommit[];
}

// ASCII record/unit separators: can't plausibly appear in a commit subject or author name, so no
// escaping is needed to parse the format back apart.
const RECORD_SEP = "\x1e";
const FIELD_SEP = "\x1f";

/**
 * Runs `git log` in the project root and returns the newest `maxCount` commits with the files each changed.
 * File names are run through the same read-restricted-globs filter `git_diff` applies, so a
 * tracked `.env` can't have its path disclosed just by appearing in a commit's file list.
 */
export async function gitLog(sb: Sandbox, opts: GitLogOptions = {}): Promise<GitLogResult> {
  const maxCount = Math.min(Math.max(Math.trunc(opts.maxCount ?? DEFAULT_MAX_COUNT), 1), MAX_COUNT_CEILING);
  const args = [
    "log",
    `--max-count=${maxCount}`,
    `--format=${RECORD_SEP}%H${FIELD_SEP}%an${FIELD_SEP}%aI${FIELD_SEP}%s`,
    "--name-only",
  ];
  const scope = opts.path ? sb.relative(opts.path) : "";
  if (scope) args.push("--", scope);

  let stdout: string;
  try {
    ({ stdout } = await execFile("git", args, { cwd: sb.root, signal: opts.signal, maxBuffer: MAX_BUFFER }));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).name === "AbortError") throw err;
    // A repository with no commits yet makes `git log` exit non-zero; that's just "no history".
    if (/does not have any commits yet/.test(describeError(err))) return { commits: [] };
    throw new Error(`git log failed: ${describeError(err)}`);
  }

  const commits: GitLogCommit[] = [];
  for (const record of stdout.split(RECORD_SEP)) {
    if (record.trim() === "") continue;
    const [header = "", ...rest] = record.split(/\r?\n/);
    const [hash = "", author = "", date = "", subject = ""] = header.split(FIELD_SEP);
    const files = rest
      .filter((f) => f !== "")
      .filter((f) => sb.allowsReported(f));
    commits.push({ hash, author, date, subject, files });
  }
  return { commits };
}

function describeError(err: unknown): string {
  const e = err as NodeJS.ErrnoException & { stderr?: string };
  if (e.code === "ENOENT") return "git is not installed or not on PATH";
  return e.stderr?.trim() || e.message || String(err);
}

export function formatGitLog(result: GitLogResult): string {
  if (result.commits.length === 0) return "No commits.";
  return result.commits
    .map((c) => {
      const lines = [`commit ${c.hash}`, `Author: ${c.author}`, `Date:   ${c.date}`, `    ${c.subject}`];
      if (c.files.length > 0) lines.push("", "  Files:", ...c.files.map((f) => `    ${f}`));
      return lines.join("\n");
    })
    .join("\n\n");
}

export function registerGitLogTool(pi: ToolRegistry) {
  pi.registerTool({
    ...GIT_LOG_TOOL_DEFINITION,
    prepareArguments: withConciseValidationErrors(GIT_LOG_TOOL_DEFINITION.name, GIT_LOG_TOOL_DEFINITION.parameters),
    renderCall(args, theme) {
      let text = callName(theme, "git_log");
      if (args.maxCount) text += theme.fg("toolOutput", ` -${args.maxCount}`);
      if (args.path) text += theme.fg("toolOutput", ` ${args.path}`);
      return oneLine(text);
    },
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const result = await gitLog(sandboxFor(ctx.cwd), { maxCount: params.maxCount, path: params.path, signal });

      return {
        content: [{ type: "text", text: formatGitLog(result) }],
        details: { count: result.commits.length },
      };
    },
  });
}
