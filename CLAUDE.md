# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A [Pi coding agent](https://pi.dev) extension (`@earendil-works/pi-coding-agent`) that disables Pi's built-in `bash` tool — intended for smaller/weaker models that do better with constrained, structured tools than with a raw shell.

The extension is loaded directly from TypeScript source (`index.ts`, declared via the `pi.extensions` field in `package.json`); there is no build step. Node 24's native TypeScript type-stripping runs the `.ts` files as-is, both for the extension itself and for tests.

## Commands

- Run all tests: `npm test` (runs `node --test tests/**/*.test.ts`)
- Run a single test file: `node --test tests/find.test.ts`
- Type-check without emitting: `npx tsc --noEmit`
- Try the extension in a live Pi session without installing it: `pi -e ./index.ts`

There is no lint or build script.

## Architecture

Each tool (`find`, `grep`, `list`, `edit`, `mkdir`, `remove`, `lstat`, `insert`) is split into two files that must stay in sync (`grep` has a third — see below):

- `src/tool_definitions/<tool>.ts` — the static `*_TOOL_DEFINITION` object: name, description, `promptSnippet`/`promptGuidelines` (shown to the model), and the typebox `parameters` schema.
- `src/tools/<tool>.ts` — spreads the definition into `pi.registerTool({...})` and implements `execute()`. Each file also exports a plain async function (`findFiles`, `grepFiles`, `listDir`, `editFile`, `makeDir`, `removePath`, `lstatPath`, `insertText`) that does the actual work independent of the Pi tool wrapper — this is what the tests in `tests/` exercise directly, without going through `ExtensionAPI`.

`index.ts` is the extension entry point: it registers all eight tools, then on `session_start` filters `bash` out of the active tool list. `find`/`grep`/`edit` share their names with Pi's built-in tools, so registering them under the same name replaces the built-ins automatically (per Pi's tool registry); `list`/`mkdir`/`remove`/`lstat`/`insert` have no built-in name collision (Pi's `ls` equivalent stays active alongside `list`).

Pi's built-in `edit` tool takes a `path` plus an `edits` array (each `{oldText, newText}`), letting one call make several disjoint changes. This project's `edit` tool intentionally simplifies that to a single `{path, oldText, newText}` per call — `oldText` must match exactly one location in the file, or `editFile` throws. Callers needing multiple changes to one file make multiple `edit` calls. Set `allowMultipleMatches: true` to opt out of the uniqueness check and replace every occurrence of `oldText` instead.

`remove` refuses to delete a directory unless `recursive: true` is set, and refuses to delete the project root outright (checked in `execute()` by comparing the resolved target against the resolved `ctx.cwd`, since `removePath` itself is root-agnostic like the other plain tool functions). `mkdir` always behaves like `mkdir -p` (creates missing parents, no-ops if the directory already exists). `lstat` never follows symlinks (`isSymbolicLink` is reported rather than resolved through). `insert` adds text after a 1-indexed `line` (matching the line numbers `grep` reports) without touching existing content; `line: 0` inserts before the first line, and `line` equal to the file's line count appends at the end. `insert` also detects the target file's line-ending style (`\r\n` vs `\n`) from its existing content and reuses it when splicing in the new line(s), so inserting into a CRLF file doesn't leave the new line terminated with a bare `\n` while the rest of the file stays CRLF.

`find`, `grep`, and `list`'s plain functions all return a `{..., total, truncated}`-shaped result (`findFiles` → `{matches, total, truncated}`, `grepFiles` → `{lines, matchCount, filesScanned, truncated}`, `listDir` → `{entries, total, truncated}`) and all cap output at a `maxResults` option (default 200). `truncated` is only set once the scan actually finds one more match/entry beyond the cap — not merely when the running count reaches it — so an exact-boundary result (e.g. exactly 200 matches with `maxResults: 200`) isn't incorrectly flagged as truncated.

`grep`'s actual file-scanning loop runs off the main thread, in `src/tools/grepWorker.ts`. `grepFiles()` (in `src/tools/grep.ts`) glob-expands the file list on the main thread, then hands `{base, files, pattern, flags, max, context}` to a fresh `worker_threads.Worker` and races it against a wall-clock timeout (`GrepOptions.timeoutMs`, default 5000ms via `DEFAULT_TIMEOUT_MS`; not exposed as a tool parameter). This exists because a single synchronous `RegExp.test()` call on a catastrophically-backtracking pattern (e.g. `(a+)+$`) can't be interrupted by an `AbortSignal` check between iterations — the only way to stop it is to kill the thread it's running on. On timeout or `AbortSignal` abort, the worker is `terminate()`d and the call rejects with an error naming the pattern; on success the worker posts back a `GrepResult`-shaped message and is terminated normally. Each `grepFiles()` call spins up a new worker rather than pooling one (~10-50ms startup overhead) since call volume is low (interactive tool calls, not a hot loop). Worker threads can load `.ts` sources directly the same way the main process does (Node 24 native type-stripping applies inside workers too), so `grepWorker.ts` needs no separate build step.

Shared infrastructure:

- `src/pathSafety.ts` — `resolveSafePath(root, target)` resolves a user-supplied path against the project root and throws if it would escape it. Every tool's `execute()` calls this before touching the filesystem — this is the sandboxing boundary that makes it safe to expose filesystem tools to the model without bash. The check has two layers: first a lexical `..`-traversal / absolute-path check on `path.relative(root, resolved)`; then a symlink-aware check that resolves both `root` and the target to their real (symlink-followed) paths and re-verifies containment — this closes the gap where a symlink living inside the project root points outside it (the lexical check alone can't see through a symlink, but a subsequent `fs.readFile`/`writeFile`/`rm` call would follow it). Because targets are often paths that don't exist yet (`mkdir`, or a new file under a not-yet-created directory), the real-path resolution walks each path up to its nearest *existing* ancestor, resolves only that ancestor with `fs.realpathSync`, and reattaches the missing suffix lexically — this also means `resolveSafePath` degrades gracefully (no throw) when `root` itself doesn't exist on disk, which is how `tests/pathSafety.test.ts` exercises the lexical-only cases without touching the real filesystem.
- `src/ignore.ts` — `DEFAULT_IGNORE_GLOBS` (fast-glob patterns, used by `find`/`grep`) and `DEFAULT_IGNORE_NAMES` (a `Set` of bare directory names, used by `list`'s manual `fs.readdir` walk) — both cover `node_modules`, `.git`, `dist`, `build`, `.pi`.

`tests/fixtures.ts` provides `makeFixture`/`cleanupFixture` for creating and tearing down temp directories with a given file tree; every tool test builds a fixture, calls the tool's plain async function against it, and asserts on the returned result object (not the rendered text). `tests/pathSafety.test.ts`'s symlink-escape tests create real symlinks via `fs.symlink` and call `t.skip()` when that fails with `EPERM` — expected on Windows without Developer Mode or admin privileges, so those tests report as skipped rather than failed in that environment.
