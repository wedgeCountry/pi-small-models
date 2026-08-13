# Architecture

A high-level overview for humans reading the repo. For the full, current detail (exact file names,
edge cases, rationale) see [`CLAUDE.md`](../CLAUDE.md) — this doc intentionally stays short and doesn't try
to duplicate it.

## What this is

A [Pi coding agent](https://pi.dev) extension that disables Pi's built-in `bash` tool and replaces it with
structured, single-purpose filesystem tools — `find`, `grep`, `list`, `edit`, `mkdir`, `remove`, `lstat`,
`insert`, `read`, `write`, plus read-only `git_status`/`git_diff`. The premise: smaller/weaker models do
better with constrained, structured tools than with a raw shell.

No build step — everything runs directly from TypeScript source via Node 24's native type-stripping.

## Tool structure

Each tool is split into a static definition (`src/tool_definitions/<tool>.ts` — name, description, schema)
and an implementation (`src/tools/<tool>.ts` — the `pi.registerTool()` wrapper plus a plain, independently
testable async function). `find`/`grep`/`edit`/`read`/`write` share names with Pi's built-ins and replace
them automatically; the rest are new tools with no built-in equivalent.

## Sandboxing

Two layers, both under `src/`:

- **`pathSafety.ts`** — the hard, always-on containment check: a tool can't be pointed outside the project
  root, symlinks included.
- **`sandbox.ts`** — wraps that with a toggleable, mode-aware restricted-path layer on top (blocking things
  like `.ssh/`, `.env`, and — in edit mode — `.git/`), togglable via `/toggle-sandbox`. Turning it off
  hands enforcement to an optional cooperating permission-system extension instead.

## Everything else

Design choices (simplified `edit` API, capped/truncated result shapes, line-ending preservation),
cancellation handling, the grep worker thread, shared infra (`ignore.ts`, `mutationQueue.ts`), and the
testing pattern are all documented in `CLAUDE.md`.
