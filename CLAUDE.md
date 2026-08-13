# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A [Pi coding agent](https://pi.dev) extension (`@earendil-works/pi-coding-agent`) that disables Pi's built-in `bash` tool and replaces it with structured, single-purpose filesystem tools — for smaller/weaker models that do better with constrained tools than a raw shell.

No build step: `index.ts` and everything under `src/` run directly via Node 24's native TypeScript type-stripping, in both the extension and its tests.

## Commands

- Run all tests: `npm test` (runs `node --test src/tests/**/*.test.ts`)
- Run a single test file: `node --test src/tests/find.test.ts`
- Type-check without emitting: `npx tsc --noEmit`
- Try the extension in a live Pi session without installing it: `pi -e ./index.ts`

There is no lint or build script.

## Tool structure

Each tool (`find`, `grep`, `list`, `edit`, `mkdir`, `remove`, `lstat`, `insert`, `read`, `write`, `git_status`, `git_diff`) is split into two files that must stay in sync:

- `src/tool_definitions/<tool>.ts` — the static `*_TOOL_DEFINITION`: name, description, `promptSnippet`/`promptGuidelines` shown to the model, and the typebox `parameters` schema.
- `src/tools/<tool>.ts` — spreads the definition into `pi.registerTool({...})` and implements `execute()`. Each file also exports a plain async function (`findFiles`, `grepFiles`, `listDir`, `editFile`, `makeDir`, `removePath`, `lstatPath`, `insertText`, `readFile`, `writeFile`, `gitStatus`, `gitDiff`) that does the real work independent of `ExtensionAPI` — this is what `src/tests/` calls directly. `grep` also has `src/tools/grepWorker.ts` (see below).

`index.ts` registers all twelve tools, then on `session_start` filters `bash` out of the active tool list. `find`/`grep`/`edit`/`read`/`write` share names with Pi's built-ins and replace them automatically (same-name registration wins per Pi's tool registry); `list`/`mkdir`/`remove`/`lstat`/`insert`/`git_status`/`git_diff` have no built-in collision. `index.ts` also registers `/toggle-sandbox` (see below) and resets sandbox state to `"on"` on every `session_start`, since it's a process-lifetime variable, not a per-session one.

## Sandboxing

- **`src/pathSafety.ts`** — `resolveSafePath(root, target)`: the hard, non-toggleable containment primitive. Checks (1) lexical `..`-traversal/absolute-path escape and (2) a symlink-aware recheck (resolves both `root` and `target` to their real paths and reverifies containment), closing the gap where an in-root symlink points outside it. Targets that don't exist yet (e.g. `mkdir`) are handled by resolving only the nearest *existing* ancestor and reattaching the missing suffix lexically. Also exports `isEntryWithinBase(base, entryPath)`, the same check applied to an already-discovered entry. **Only `sandbox.ts` calls this file** — no tool imports it directly.
- **`src/sandbox.ts`** — `resolveSandboxPath(root, target, mode)` is what every tool's `execute()` actually calls (`mode` is `"read"` for `find`/`grep`/`list`/`lstat`/`read`/`git_status`/`git_diff`, `"edit"` for `write`/`edit`/`insert`/`remove`/`mkdir`). It wraps `resolveSafePath` with a second, mode-aware layer: a `READ_RESTRICTED_GLOBS` list (SSH keys, `.aws`, `.env*`, `.netrc`, `.npmrc`, `.pgpass`, `.docker`, `.kube`, `.gnupg`, gcloud config, private-key filenames) blocks credential access in both modes; `EDIT_RESTRICTED_GLOBS` adds `**/.git/**` on top, since edit mode shouldn't overwrite repo state either. Globs are matched against both the lexical and real (symlink-resolved) path, so a symlink disguising itself as something else is still caught. A module-level `SandboxState` (`"on"`/`"off"`, default `"on"`) gates all of this: `"off"` disables root-containment *and* restricted globs — see `src/permissionGate.ts` for what fills that gap. Set via `/toggle-sandbox` (no argument toggles `on`/`off`). `isEntrySandboxSafe(base, entryPath, mode, isSymlink)` is the same check applied to entries a directory walk *discovers* (see below), and accepts an optional `stateOverride` for callers that don't share this module's in-memory state (namely `grepWorker.ts`, which runs in its own thread with its own copy starting at `"on"`).
- **Directory-walk entries aren't covered by a single `resolveSandboxPath` call.** `find`/`grep`/`list` glob or `readdir` beneath an already-safe base, and a symlink in that tree can point outside it even though the base passed. `fast-glob`'s `followSymbolicLinks: false` only stops *descending into* a symlinked directory, not excluding a symlinked file from the results. `find.ts`/`grep.ts` request `objectMode: true` from fast-glob (free `dirent` access) and drop any entry failing `isEntrySandboxSafe`; `list.ts`'s manual `readdir` walk does the same, and never recurses into a symlinked directory since `Dirent.isDirectory()` is false for one.
- **`src/permissionGate.ts`** — this project's own on/off decision system, built directly on Pi's `ExtensionAPI` (`pi.on("tool_call", ...)` plus `ctx.ui.confirm`) and registered once in `index.ts`, with no session lifecycle needed. While sandbox state is `"on"`, it does nothing — `sandbox.ts` already fully enforces containment locally. While `"off"`, it intercepts every call to one of this project's 12 tools before it runs and requires an explicit `ctx.ui.confirm()` approval (one-shot, not remembered); declining blocks the call with a reason the model sees, and a non-interactive context (`ctx.hasUI === false`) blocks automatically since there's no one to ask. An earlier version of this file tried to integrate with the separate `@gotgenes/pi-permission-system` extension via a `registerAuthorizer` hook so `"on"` could auto-suppress a second prompt from that extension; that hook doesn't exist on the package's actual public API (it only exposes `checkPermission`/`getToolPermission` and prompt-text formatting hooks, confirmed by reading the installed package's own docs), so the integration silently never worked. This file replaces it and needs no other extension installed.

## Per-tool notes

- **`edit`** — single `{path, oldText, newText}` per call (not Pi's built-in batched `edits` array); `oldText` must match exactly one location or it throws, unless `allowMultipleMatches: true`. Both content and `oldText`/`newText` are LF-normalized before matching (so `\n`-written text still matches a CRLF file and vice versa), and the file's original line-ending style is reapplied on write.
- **`insert`** — inserts text after a 1-indexed `line` (matching `grep`'s numbering) without touching existing content; `line: 0` inserts before the first line, `line` equal to the file's line count appends at the end. Preserves the file's existing CRLF/LF style.
- **`read`** — replaces Pi's built-in (text-only, no image support). `offset`/`limit` select a line range; output is additionally capped at 2000 lines/50KB (`DEFAULT_MAX_LINES`/`DEFAULT_MAX_BYTES` in `src/tools/read.ts`). `truncated` is set whenever the range stops short of the file's end, with a `[Showing lines X-Y of Z. Use offset=N to continue.]` hint. Read-only, so it skips the mutation queue (see below).
- **`write`** — mirrors Pi's built-in (create/overwrite, `mkdir -p` parents first) but goes through `resolveSandboxPath` (mode `"edit"`) first, which the built-in doesn't.
- **`remove`** — refuses to delete a directory without `recursive: true`, and refuses to delete the project root outright (a `projectRoot` option on `removePath` itself, checked before even `lstat`-ing the target, so it's covered by the same plain-function tests as everything else).
- **`mkdir`** — always `mkdir -p` semantics (creates missing parents, no-ops if it already exists).
- **`lstat`** — never follows symlinks; reports `isSymbolicLink` rather than resolving through it.
- **`find`/`grep`/`list`** — all return a `{..., total, truncated}` shape and cap output at `maxResults` (default 200). `truncated` is only set once the scan finds one match/entry *beyond* the cap, so an exact-boundary result isn't wrongly flagged.
- **`grep`** — the scan loop runs off the main thread in `grepWorker.ts`, since a catastrophically-backtracking regex (e.g. `(a+)+$`) can only be stopped by killing its thread, not by checking an `AbortSignal` mid-scan. `grepFiles()` glob-expands and sandbox-filters on the main thread, then hands the file list (plus a `sandboxState` snapshot) to a fresh `Worker` and races it against a 5s wall-clock timeout (`DEFAULT_TIMEOUT_MS`, not tool-exposed); on timeout/abort the worker is `terminate()`d. The worker re-checks `isEntrySandboxSafe` itself before reading each file rather than trusting the main thread's pre-filter, reusing the `isSymlink` flag it was handed to avoid a redundant `lstat`.
- **`git_status`/`git_diff`** — the only tools that don't touch the filesystem directly; they shell out to `git` via `execFile` (array args, no shell, no injection surface), `cwd` pinned to the project root. `git_status` parses `git status --porcelain=v1 --branch` into `{branch, ahead, behind, entries}`. `git_diff` runs plain `git diff` (unstaged only) through the same truncation cap `read` uses. Both accept an optional `path` to scope the call, sandboxed (mode `"read"`) when passed — but **also** filter their parsed results against the restricted-globs list on every call, scoped or not, so a tracked `.env` with an uncommitted change can't leak its path via `git_status` or its content via `git_diff` just because no `path` was given. Read-only, so both skip the mutation queue.

## Cancellation

`fs.readFile`/`fs.writeFile` and `child_process.execFile` all honor `AbortSignal` natively, so `edit`, `insert`, `write` (its write step), and `gitStatus`/`gitDiff` just pass `signal` through. `fs.mkdir`/`fs.rm` don't accept a `signal` at all, so `mkdir`, a non-recursive `remove`, and `write`'s preceding `mkdir({recursive: true})` just check `throwIfAborted()` once up front — reasonable since none is more than a handful of syscalls. A recursive `remove` can walk an arbitrarily large tree, so `removeRecursively` walks entries itself and checks `signal` before each one (same pattern as `list.ts`'s `walk()`). `find` uses fast-glob's `fg.stream()` instead of the promise API and `.destroy()`s it on abort, since the promise form can't be interrupted once started.

## Shared infrastructure

- **`src/ignore.ts`** — `DEFAULT_IGNORE_GLOBS` (fast-glob patterns, used by `find`/`grep`) and `DEFAULT_IGNORE_NAMES` (bare directory names, used by `list`'s manual walk) — both cover `node_modules`, `.git`, `dist`, `build`, `.pi`.
- **`src/mutationQueue.ts`** — `withFileMutationQueue(filePath, fn)` serializes mutating operations on the same file, keyed by its real (symlink-resolved) path. `writeFile`, `editFile`/`editFileMulti`, `insertText`, and `removePath` each wrap their whole read-modify-write in this, so overlapping calls on the same path queue instead of interleaving and silently discarding each other's changes. Modeled on Pi's own built-in `write`/`edit` tools, which have an equivalent helper.

## Testing

`src/tests/fixtures.ts` provides `makeFixture`/`cleanupFixture` for temp directories with a given file tree; every tool test builds a fixture, calls the tool's plain async function, and asserts on the returned result object rather than rendered text. `src/tests/pathSafety.test.ts` and `src/tests/sandbox.test.ts`'s symlink-escape tests create real symlinks via `fs.symlink` and `t.skip()` on `EPERM` — expected on Windows without Developer Mode or admin privileges.
