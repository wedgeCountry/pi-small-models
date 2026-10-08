# Architecture

A high-level overview for humans reading the repo. For the full, current detail (exact file names,
edge cases, rationale) see [`CLAUDE.md`](../CLAUDE.md) — this doc intentionally stays short and doesn't try
to duplicate it.

## What this is

A [Pi coding agent](https://pi.dev) extension that disables Pi's built-in `bash` tool and replaces it with
structured, single-purpose filesystem tools — `find`, `grep`, `list`, `edit`, `mkdir`, `remove`, `lstat`,
`insert`, `read`, `write`, plus read-only `git_status`/`git_diff` and `peek` (a structural outline of a code
or Markdown file: signatures without bodies, or the heading table of contents). The premise: smaller/weaker models do
better with constrained, structured tools than with a raw shell.

No build step — everything runs directly from TypeScript source via Node 24's native type-stripping.

## Tool structure

Each tool is split into a static definition (`src/tool_definitions/<tool>.ts` — name, description, schema)
and an implementation (`src/tools/<tool>.ts` — the `pi.registerTool()` wrapper plus a plain, independently
testable async function). `find`/`grep`/`edit`/`read`/`write` share names with Pi's built-ins and replace
them automatically; the rest are new tools with no built-in equivalent.

## Peek and PreviewManagers

`peek` picks a PreviewManager by file extension (`src/tools/previewManagers/registry.ts`) — Python,
TypeScript/JavaScript, C# and Markdown. Each manager is driven by a regex table at the top of its file, so what
peek shows for a language is changed there. Python is indentation-based; TypeScript and C# share a small
brace-tracking scanner (`braceEngine.ts`). A `visibility` parameter (public/protected/private, inclusive) and
`includeDocs` control how much is shown; Markdown takes `maxDepth` instead.

## Library tools

`ts_lib`, `py_lib` and `dotnet_lib` describe installed packages. Each one locates the package and
extracts a flat list of API entries (`src/tools/libInfo/`); shared code in `query.ts`/`format.ts` turns
that into the same overview / search / symbol views for all three. TypeScript uses the TypeScript
compiler API, Python runs a small stdlib-only helper script (`py_libinfo.py`) in the project's
interpreter that reads source with `ast`, and .NET reads the XML documentation files next to the
package's assemblies. `py_list` lists Python packages through the same helper.

## Sandboxing

Everything lives in `src/sandbox/`:

- **`policy.ts`** — what is protected: credential stores (`.ssh/`, `.env*`, `.aws/`, …) and `.git/`, as one
  glob list, plus the pure checks `isRestricted` and `isInside`.
- **`sandbox.ts`** — `Sandbox`, one unchangeable object per tool call (`sandboxFor(ctx.cwd)`). Tools never
  check paths themselves; they ask it to `resolve` a path the model gave, filter what a directory walk found
  (`entryFilter`), filter paths git reports (`allowsReported`), or resolve a file inside an installed package
  (`resolveLibraryFile` — the one read-only exception to root containment, limited to roots derived from
  package-manager metadata). Every check runs on the path as given and on its real, symlink-resolved path.
- **`permissionGate.ts`** — `/toggle-sandbox off` turns the checks off; in exchange every tool registered
  through the gated registry asks for confirmation before each call (blocked without a UI).

## Everything else

Design choices (simplified `edit` API, capped/truncated result shapes, line-ending preservation),
cancellation handling, the grep worker thread, shared infra (`ignore.ts`, `mutationQueue.ts`), and the
testing pattern are all documented in `CLAUDE.md`.
