# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A [Pi coding agent](https://pi.dev) extension (`@earendil-works/pi-coding-agent`) that replaces Pi's built-in `bash` tool with structured, single-purpose filesystem tools for smaller models.

No build step: runs directly via Node 24's native TypeScript type-stripping.

## Structure

Each tool (`find`, `grep`, `list`, `edit`, `mkdir`, `remove`, `copy`, `move`, `lstat`, `insert`, `read`, `peek`, `write`, `git_status`, `git_diff`, `git_log`) is split into:
- `src/tool_definitions/<tool>.ts` — tool definition (schema, prompts)
- `src/tools/<tool>.ts` — implementation with `execute()` and exported async function

`index.ts` registers all tools, disables `bash`, and resets sandbox on `session_start`.

## Sandboxing

- `src/sandbox/policy.ts` — defines restricted paths (SSH keys, `.env*`, `.git/**`, etc.)
- `src/sandbox/sandbox.ts` — `Sandbox` class: path resolution, symlink checks, entry filtering
- `src/sandbox/permissionGate.ts` — prompts when sandbox is off

Toggle with `/toggle-sandbox [on|off]`. Tools take `Sandbox` first, tests use `new Sandbox(dir)`.
