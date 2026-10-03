import fg from "fast-glob";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DEFAULT_IGNORE_GLOBS, getEffectiveIgnoreGlobs } from "../ignore.ts";
import { resolveSandboxPath, isEntrySandboxSafe } from "../sandbox.ts";
import { oneLine, callName } from "../renderCall.ts";
import { FIND_USAGES_TOOL_DEFINITION } from "../tool_definitions/find_usages.ts";
import { LANGUAGE_RULES, type FindUsagesLanguage } from "./usageRules/registry.ts";
import { isValidIdentifier } from "./usageRules/shared.ts";
import type { UsageKind } from "./usageRules/types.ts";

export interface FindUsagesMatch {
  file: string;
  line: number;
  text: string;
  kind: UsageKind;
}

export interface FindUsagesResult {
  matches: FindUsagesMatch[];
  total: number;
  filesScanned: number;
  truncated: boolean;
}

export interface FindUsagesOptions {
  maxResults?: number;
  signal?: AbortSignal;
  /** Ignore globs to apply. Defaults to `DEFAULT_IGNORE_GLOBS` — pass `getEffectiveIgnoreGlobs()`'s
   * result to also honor `/ignore`'s global and local ignore files, same as grep. */
  ignoreGlobs?: string[];
}

/**
 * Detects which language's rule table applies to `base`, from project markers: a .sln or .csproj
 * file anywhere under it means csharp, a top-level .venv folder means python, a top-level
 * node_modules folder means typescript. Throws if zero or more than one marker is found, since
 * there's no language rule to fall back on in that case.
 */
async function detectLanguage(base: string, ignoreGlobs: string[], signal?: AbortSignal): Promise<FindUsagesLanguage> {
  const [hasCSharpMarkers, hasVenv, hasNodeModules] = await Promise.all([
    fg(["**/*.sln", "**/*.csproj"], {
      cwd: base,
      ignore: ignoreGlobs,
      onlyFiles: true,
      dot: false,
      followSymbolicLinks: false,
    }).then((entries) => entries.length > 0),
    fs
      .stat(path.join(base, ".venv"))
      .then((s) => s.isDirectory())
      .catch(() => false),
    fs
      .stat(path.join(base, "node_modules"))
      .then((s) => s.isDirectory())
      .catch(() => false),
  ]);

  signal?.throwIfAborted();

  const detected: FindUsagesLanguage[] = [];
  if (hasCSharpMarkers) detected.push("csharp");
  if (hasVenv) detected.push("python");
  if (hasNodeModules) detected.push("typescript");

  if (detected.length !== 1) {
    const reason =
      detected.length === 0
        ? "found none of: a .sln/.csproj file, a .venv folder, a node_modules folder"
        : `found markers for multiple languages (${detected.join(", ")})`;
    throw new Error(`find_usages could not auto-detect a language under "${base}" (${reason}) — specify "language" explicitly.`);
  }

  return detected[0]!;
}

/**
 * Finds structural usages of `symbol` under `base`, applying `language`'s regex-based rule table
 * (see src/tools/usageRules/). Unlike `grepFiles`, this never hands user-controlled text to the
 * regex engine as a *pattern* — `symbol` is validated as a plain identifier and only ever
 * interpolated as an escaped literal into a small, fixed, pre-reviewed set of patterns per
 * language, so there's no catastrophic-backtracking surface to guard against and no worker thread
 * is needed (contrast with grep.ts, which takes an arbitrary regex from the caller).
 *
 * `language` defaults to `"auto"`, which calls `detectLanguage` against `base`.
 */
export async function findUsages(
  base: string,
  symbol: string,
  language: FindUsagesLanguage | "auto" = "auto",
  opts: FindUsagesOptions = {}
): Promise<FindUsagesResult> {
  if (!isValidIdentifier(symbol)) {
    throw new Error(
      `find_usages symbol "${symbol}" is not a valid identifier — expected letters, digits, and ` +
        `underscores, not starting with a digit.`
    );
  }

  const max = opts.maxResults ?? 200;
  const ignoreGlobs = opts.ignoreGlobs ?? DEFAULT_IGNORE_GLOBS;

  let baseStat;
  try {
    baseStat = await fs.stat(base);
  } catch {
    throw new Error(`find_usages path "${base}" does not exist.`);
  }
  if (!baseStat.isDirectory()) {
    throw new Error(`find_usages path "${base}" is a file, not a directory. Use "path" to point at a directory.`);
  }

  opts.signal?.throwIfAborted();

  const resolvedLanguage = language === "auto" ? await detectLanguage(base, ignoreGlobs, opts.signal) : language;
  const rule = LANGUAGE_RULES[resolvedLanguage];

  const entries = await fg(rule.glob, {
    cwd: base,
    ignore: ignoreGlobs,
    onlyFiles: true,
    dot: false,
    followSymbolicLinks: false,
    objectMode: true,
  });

  // See grep.ts's identical comment: followSymbolicLinks: false only stops descending into a
  // symlinked directory, not excluding a symlinked file from the results, so every entry is
  // re-checked against the sandbox before its contents are ever read.
  const filePaths = entries
    .filter((e) => isEntrySandboxSafe(base, e.path, "read", e.dirent.isSymbolicLink()))
    .map((e) => e.path)
    .sort((a, b) => a.localeCompare(b));

  const files: { path: string; lines: string[] }[] = [];
  for (const filePath of filePaths) {
    opts.signal?.throwIfAborted();
    let content: string;
    try {
      content = await fs.readFile(path.join(base, filePath), { encoding: "utf8", signal: opts.signal });
    } catch (err) {
      if ((err as { name?: string }).name === "AbortError") throw err;
      continue; // unreadable or not text
    }
    if (content.includes("\0")) continue; // skip binary files
    files.push({ path: filePath, lines: content.split("\n") });
  }

  // Resolves Python's function-vs-class bare-call ambiguity once, over every line in the scoped
  // scan, before classification starts — see python.ts's docstring. A no-op for languages whose
  // rule has no detectKind (classifyLine simply ignores the knownKind it's handed).
  const knownKind = rule.detectKind?.(
    files.flatMap((f) => f.lines),
    symbol
  ) ?? "unknown";

  const matches: FindUsagesMatch[] = [];
  let total = 0;
  let truncated = false;

  outer: for (const file of files) {
    opts.signal?.throwIfAborted();
    for (let i = 0; i < file.lines.length; i++) {
      const line = file.lines[i] ?? "";
      const kind = rule.classifyLine(line, symbol, knownKind);
      if (!kind) continue;
      if (total >= max) {
        truncated = true;
        break outer;
      }
      total++;
      matches.push({ file: file.path, line: i + 1, text: line, kind });
    }
  }

  return { matches, total, filesScanned: files.length, truncated };
}

export function registerFindUsagesTool(pi: ExtensionAPI) {
  pi.registerTool({
    ...FIND_USAGES_TOOL_DEFINITION,
    renderCall(args, theme) {
      let text = `${callName(theme, "find_usages")} ${theme.fg("accent", args.symbol ?? "")}`;
      text += theme.fg("toolOutput", ` (${args.language ?? "auto"})`);
      if (args.path) text += theme.fg("toolOutput", ` in ${args.path}`);
      return oneLine(text);
    },
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const base = resolveSandboxPath(ctx.cwd, params.path ?? ".", "read");
      const ignoreGlobs = await getEffectiveIgnoreGlobs(ctx.cwd, getAgentDir());
      const result = await findUsages(base, params.symbol, params.language as FindUsagesLanguage | "auto" | undefined, {
        maxResults: params.maxResults,
        signal,
        ignoreGlobs,
      });

      const text = result.matches.length
        ? result.matches.map((m) => `${m.file}:${m.line}:[${m.kind}]: ${m.text}`).join("\n") +
          (result.truncated ? `\n… results truncated at ${params.maxResults ?? 200} matches` : "")
        : "No usages found.";

      return {
        content: [{ type: "text", text }],
        details: { total: result.total, filesScanned: result.filesScanned, truncated: result.truncated },
      };
    },
  });
}
