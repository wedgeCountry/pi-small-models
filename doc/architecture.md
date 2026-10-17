# Architecture

A high-level overview of this Pi coding agent extension. For full details, see [`../AGENTS.md`](../AGENTS.md).

## What this is

A [Pi coding agent](https://pi.dev) extension (`@earendil-works/pi-coding-agent`) that replaces Pi's built-in `bash` tool with structured, single-purpose filesystem tools for smaller models.

No build step: runs directly from TypeScript source via Node 24's native type-stripping.

## Tool Structure

Each tool is split into:
- `src/tool_definitions/<tool>.ts` — tool definition (name, description, schema)
- `src/tools/<tool>.ts` — implementation with `execute()` and exported async function

Tools include: `find`, `grep`, `list`, `edit`, `mkdir`, `remove`, `copy`, `move`, `lstat`, `insert`, `read`, `peek`, `write`, `git_status`, `git_diff`, `git_log`, plus `find_usages` and `search`.

`index.ts` registers all tools, disables `bash`, and resets sandbox on `session_start`.

## Preview Managers

`peek` uses PreviewManagers by file extension (`src/tools/previewManagers/registry.ts`) for Python, TypeScript/JavaScript, C#, and Markdown. Each manager uses regex patterns to extract structure - Python is indentation-based, TypeScript and C# share a brace-tracking scanner (`braceEngine.ts`).

## Library Tools

`find_usages` and `search` tools use language-specific analysis:
- TypeScript: compiler API
- Python: `ast` via helper script
- .NET: XML documentation files

Shared code in `libInfo/` handles extraction and formatting.

## Sandboxing

- `src/sandbox/policy.ts` — restricted paths (SSH keys, `.env*`, `.git/`, etc.)
- `src/sandbox/sandbox.ts` — `Sandbox` class for path resolution and filtering
- `src/sandbox/permissionGate.ts` — confirmation prompts when sandbox is off

Toggle with `/toggle-sandbox [on|off]`. Tools take `Sandbox` first, tests use `new Sandbox(dir)`.

## Shared Infrastructure

- `backend/` — grep worker thread, mutation queue, tool validation
- `commands/` — ignore patterns and command execution
- Design choices, cancellation handling, and testing patterns are documented in `../AGENTS.md`.