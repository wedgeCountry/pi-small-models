# src

Implementation of the Pi extension registered in `../index.ts`.

- `tool_definitions/` — static `*_TOOL_DEFINITION` objects (name, description, `parameters` schema) shown to the model. See its own `README.md`.
- `tools/` — `pi.registerTool({...})` calls that pair each definition with an `execute()`, plus a plain async function per tool (`findFiles`, `grepFiles`, `listDir`, `editFile`, `makeDir`, `removePath`, `lstatPath`, `insertText`, `readFile`, `writeFile`, `gitStatus`, `gitDiff`) that the tests call directly. Also holds `grepWorker.ts`, the off-main-thread scan loop `grep.ts` delegates to. See its own `README.md`.
- `sandbox.ts` — `resolveSandboxPath(root, target, mode)`, the sandboxing boundary every tool uses before touching the filesystem. Wraps `pathSafety.ts`'s hard root-containment check with a toggleable, mode-aware (`"read"`/`"edit"`) restricted-path check (credential globs in `"read"` mode; those plus `.git/**` in `"edit"` mode); state is `on`/`off`, settable via the `/toggle-sandbox` command. `"off"` bypasses everything, including root containment. Also exports `isEntrySandboxSafe(base, entryPath, mode, isSymlink)`, used by `find`/`grep`/`list` to filter entries a directory walk *discovers* underneath an already-safe base (a symlink escape a single-path check wouldn't catch), and by `git_status`/`git_diff` to filter restricted paths out of `git`'s own output.
- `pathSafety.ts` — `resolveSafePath(root, target)`, the underlying (always-on) containment primitive, plus `isEntryWithinBase`. Only `sandbox.ts` calls these directly.
- `permissionGate.ts` — this project's own on/off decision system, built on Pi's own `tool_call` event and `ctx.ui.confirm`, no other extension required. While the sandbox is `"on"`, does nothing (`sandbox.ts` already fully enforces locally). While `"off"`, intercepts every call to one of this project's 12 tools and requires an explicit, one-shot approval dialog before it runs; declining blocks the call, and a non-interactive context blocks automatically.
- `ignore.ts` — shared ignore globs/names (`node_modules`, `.git`, `dist`, `build`, `.pi`) used by `find`, `grep`, and `list`.
- `mutationQueue.ts` — `withFileMutationQueue(filePath, fn)`, serializes `write`/`edit`/`insert`/`remove` calls that target the same file (keyed by its real, symlink-resolved path) so they can't interleave their read-modify-write steps. `read`/`git_status`/`git_diff` are read-only and don't use it.
- `tests/` — `node --test` suite; one file per tool plus `pathSafety.test.ts`/`sandbox.test.ts`. See its own `README.md`.

See `doc/architecture.md` for a short overview and the root `CLAUDE.md` for the full architecture writeup.
