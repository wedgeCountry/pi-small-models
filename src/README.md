# src

Implementation of the Pi extension registered in `../index.ts`.

- `tool_definitions/` — static `*_TOOL_DEFINITION` objects (name, description, `parameters` schema) shown to the model.
- `tools/` — `pi.registerTool({...})` calls that pair each definition with an `execute()`.
- `sandbox.ts` — `resolveSandboxPath(root, target, mode)`, the sandboxing boundary every tool uses before touching the filesystem. Wraps `pathSafety.ts`'s hard root-containment check with a toggleable, mode-aware (`"read"`/`"edit"`) restricted-path check; state is `on`/`off`, settable via the `/toggle-sandbox` command. `"off"` bypasses everything, including root containment.
- `pathSafety.ts` — `resolveSafePath(root, target)`, the underlying (always-on) containment primitive. Only `sandbox.ts` calls it directly.
- `permissionAuthorizer.ts` — optional, dependency-free integration with the separate `@gotgenes/pi-permission-system` extension: while the sandbox is `"on"`, registers an authorizer that auto-allows anything inside the project root (which this sandbox already fully covers) so that extension doesn't ask about it a second time; while `"off"`, declines everything so its own policy governs unmodified. No-ops if that package isn't installed.
- `ignore.ts` — shared ignore globs/names (`node_modules`, `.git`, `dist`, `build`, `.pi`) used by `find`, `grep`, and `list`.
- `mutationQueue.ts` — `withFileMutationQueue(filePath, fn)`, serializes `write`/`edit`/`insert`/`remove` calls that target the same file so they can't interleave their read-modify-write steps.

See the root `CLAUDE.md` for the full architecture writeup.
