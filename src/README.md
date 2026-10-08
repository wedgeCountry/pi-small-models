# src

Implementation of the Pi extension registered in `../index.ts`.

- `tool_definitions/` — static `*_TOOL_DEFINITION` objects (name, description, `parameters` schema) shown to the model. See its own `README.md`.
- `tools/` — `pi.registerTool({...})` calls that pair each definition with an `execute()`, plus a plain async function per tool (`findFiles`, `grepFiles`, `listDir`, `editFile`, `makeDir`, `removePath`, `lstatPath`, `insertText`, `readFile`, `peekFile`, `writeFile`, `gitStatus`, `gitDiff`) that the tests call directly. Also holds `grepWorker.mjs`, the off-main-thread scan loop `grep.ts` delegates to, and `previewManagers/`, the per-language outliners behind `peek`. See its own `README.md`.
- `sandbox/` — the sandbox every tool goes through:
  - `policy.ts` — the protected patterns (`RESTRICTED_GLOBS`) and two pure checks, `isRestricted` and `isInside`.
  - `sandbox.ts` — `Sandbox`, an unchangeable per-call object (`sandboxFor(ctx.cwd)`) with `resolve`, `relative`, `entryFilter`, `allowsReported` and `resolveLibraryFile`/`allowsLibraryFile`; plus the `on`/`off` switch (`getSandboxState`/`setSandboxState`) and `SandboxError`.
  - `permissionGate.ts` — `createGatedRegistry` (every tool registered through it is gated) and `createPermissionGate`, the `tool_call` handler that asks before each gated call while the sandbox is off.
- `ignore.ts` — shared ignore globs/names (`node_modules`, `.git`, `dist`, `build`, `.pi`) used by `find`, `grep`, and `list`.
- `mutationQueue.ts` — `withFileMutationQueue(filePath, fn)`, serializes `write`/`edit`/`insert`/`remove` calls that target the same file (keyed by its real, symlink-resolved path) so they can't interleave their read-modify-write steps. `read`/`git_status`/`git_diff` are read-only and don't use it.
- `../tests` — `node --test` suite; one file per tool plus `sandbox.test.ts`, `permissionGate.test.ts` and `index.test.ts`. See its own `README.md`.

See `doc/architecture.md` for a short overview and the root `CLAUDE.md` for the full architecture writeup.
