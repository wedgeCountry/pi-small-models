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

Each tool (`find`, `grep`, `list`, `edit`, `mkdir`, `remove`, `lstat`, `insert`) is split into two files that must stay in sync:

- `src/tool_definitions/<tool>.ts` — the static `*_TOOL_DEFINITION` object: name, description, `promptSnippet`/`promptGuidelines` (shown to the model), and the typebox `parameters` schema.
- `src/tools/<tool>.ts` — spreads the definition into `pi.registerTool({...})` and implements `execute()`. Each file also exports a plain async function (`findFiles`, `grepFiles`, `listDir`, `editFile`, `makeDir`, `removePath`, `lstatPath`, `insertText`) that does the actual work independent of the Pi tool wrapper — this is what the tests in `tests/` exercise directly, without going through `ExtensionAPI`.

`index.ts` is the extension entry point: it registers all eight tools, then on `session_start` filters `bash` out of the active tool list. `find`/`grep`/`edit` share their names with Pi's built-in tools, so registering them under the same name replaces the built-ins automatically (per Pi's tool registry); `list`/`mkdir`/`remove`/`lstat`/`insert` have no built-in name collision (Pi's `ls` equivalent stays active alongside `list`).

Pi's built-in `edit` tool takes a `path` plus an `edits` array (each `{oldText, newText}`), letting one call make several disjoint changes. This project's `edit` tool intentionally simplifies that to a single `{path, oldText, newText}` per call — `oldText` must match exactly one location in the file, or `editFile` throws. Callers needing multiple changes to one file make multiple `edit` calls. Set `allowMultipleMatches: true` to opt out of the uniqueness check and replace every occurrence of `oldText` instead.

`remove` refuses to delete a directory unless `recursive: true` is set, and refuses to delete the project root outright (checked in `execute()` by comparing the resolved target against the resolved `ctx.cwd`, since `removePath` itself is root-agnostic like the other plain tool functions). `mkdir` always behaves like `mkdir -p` (creates missing parents, no-ops if the directory already exists). `lstat` never follows symlinks (`isSymbolicLink` is reported rather than resolved through). `insert` adds text after a 1-indexed `line` (matching the line numbers `grep` reports) without touching existing content; `line: 0` inserts before the first line, and `line` equal to the file's line count appends at the end.

Shared infrastructure:

- `src/pathSafety.ts` — `resolveSafePath(root, target)` resolves a user-supplied path against the project root and throws if it would escape it (via `..` traversal or an absolute path outside root). Every tool's `execute()` calls this before touching the filesystem — this is the sandboxing boundary that makes it safe to expose filesystem tools to the model without bash.
- `src/ignore.ts` — `DEFAULT_IGNORE_GLOBS` (fast-glob patterns, used by `find`/`grep`) and `DEFAULT_IGNORE_NAMES` (a `Set` of bare directory names, used by `list`'s manual `fs.readdir` walk) — both cover `node_modules`, `.git`, `dist`, `build`, `.pi`.

`tests/fixtures.ts` provides `makeFixture`/`cleanupFixture` for creating and tearing down temp directories with a given file tree; every tool test builds a fixture, calls the tool's plain async function against it, and asserts on the returned result object (not the rendered text).
