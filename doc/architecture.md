# Architecture

A high-level overview for humans reading the repo. For the full, current detail (exact file names,
edge cases, rationale) see [`AGENTS.md`](../AGENTS.md) — this doc intentionally stays short and doesn't try
to duplicate it.

## What this is

A [Pi coding agent](https://pi.dev) extension that disables Pi's built-in `bash` tool and replaces it with
structured, single-purpose filesystem tools — `find`, `grep`, `list`, `edit`, `mkdir`, `remove`, `lstat`,
`insert`, `read`, `write`, plus read-only `git_status`/`git_diff`/`git_log` and `find_usages` (structural usages of a
class or function), plus `pi_docs`/`pi_skills` for reading Pi's own documentation and discovered skills. `read`
defaults to a structural outline of a code or Markdown file (signatures without bodies, or the heading table of
contents) — `peek` mode, with the standalone `peek` tool currently disabled. The premise: smaller/weaker models do
better with constrained, structured tools than with a raw shell.

No build step — the TypeScript sources run directly via `tsx` (see the `test`/`start` scripts in `package.json`).

## Tool structure

Each tool is split into a static definition (`src/tool_definitions/<tool>.ts` — name, description, schema)
and an implementation (`src/tools/<tool>.ts` — the `pi.registerTool()` wrapper plus a plain, independently
testable async function). Tools with names matching Pi's built-ins (`find`, `grep`, `edit`, `read`, `write`, `list`, `copy`, `move`, `remove`, `mkdir`, `lstat`, `insert`) replace them automatically through same-name registration. The `bash` tool is explicitly disabled. Other tools (`git_status`, `git_diff`, `git_log`, `find_usages`, `pi_docs`, `pi_skills`) are new with no built-in equivalent. The `search` and `peek` tools exist but are currently deactivated (`index.ts`).

## Peek and PreviewManagers

`read` defaults to `peek=true`: without `offset`/`limit` it returns a structural outline instead of raw
contents (the standalone `peek` tool in `src/tools/peek.ts` exists but is not registered). The outline is
built by a PreviewManager picked by file extension (`src/tools/previewManagers/registry.ts`) — Python,
TypeScript/JavaScript, C# and Markdown. Each manager is driven by a regex table at the top of its file, so what
peek shows for a language is changed there. Python is indentation-based; TypeScript and C# share a small
brace-tracking scanner (`src/tools/previewManagers/braceEngine.ts`). A `visibility` parameter (public/protected/private, inclusive) and
`includeDocs` control how much is shown; Markdown takes `maxDepth` instead.

## Sandboxing

Everything lives in `src/sandbox/`:

- **`policy.ts`** — what is protected: credential stores (`.ssh/`, `.env*`, `.aws/`, …) and `.git/`, as one
  glob list, plus the pure checks `isRestricted` and `isInside`.
- **`sandbox.ts`** — `Sandbox`, one unchangeable object per tool call (`sandboxFor(ctx.cwd)`). Tools never
  check paths themselves; they ask it to `resolve` a path the model gave, filter what a directory walk found
  (`entryFilter`), or filter paths git reports (`allowsReported`). Every check runs on the path as given and on its real, symlink-resolved path.
- **`permissionGate.ts`** — `/toggle-sandbox off` turns the checks off; in exchange every tool registered
  through the gated registry asks for confirmation before each call (blocked without a UI).

## Usage Rules

The `find_usages` tool uses language-specific classification rules (`src/tools/usageRules/`) to find structural usages of symbols. 
Each language (Python, TypeScript, C#) has its own classifier that understands the language's syntax for imports, 
classes, instantiation, member access, and calls. Python includes a whole-scope pre-pass to resolve bare call ambiguity.

## Backend infrastructure

Shared utilities live in `src/backend/`: `createTool.ts` (builds the `pi.registerTool()` object from a
definition plus `renderCall`/`execute` hooks, applying the shared `prepareArguments` validation wrapper),
`renderCall.ts` (tool call rendering), `toolValidation.ts` (validation utilities),
and `grepWorker.ts`/`grepWorker.mjs` (worker thread for grep operations).

## Commands

Two slash commands are registered: `/toggle-sandbox` (toggles sandbox enforcement on/off) and `/ignore` (manages global and local ignore patterns for find/grep/list).

## Everything else

Design choices (simplified `edit` API, capped/truncated result shapes, line-ending preservation),
cancellation handling, the grep worker thread, shared infra (`ignore.ts`, `mutationQueue.ts`), and the
testing pattern are all documented in `AGENTS.md`.
