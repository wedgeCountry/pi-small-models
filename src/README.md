# src

Implementation of the Pi extension registered in `../index.ts`.

- `tool_definitions/` — static `*_TOOL_DEFINITION` objects (name, description, `parameters` schema) shown to the model.
- `tools/` — `pi.registerTool({...})` calls that pair each definition with an `execute()`.
- `pathSafety.ts` — `resolveSafePath(root, target)`, the sandboxing boundary every tool uses before touching the filesystem.
- `ignore.ts` — shared ignore globs/names (`node_modules`, `.git`, `dist`, `build`, `.pi`) used by `find`, `grep`, and `list`.
- `mutationQueue.ts` — `withFileMutationQueue(filePath, fn)`, serializes `write`/`edit`/`insert`/`remove` calls that target the same file so they can't interleave their read-modify-write steps.

See the root `CLAUDE.md` for the full architecture writeup.
