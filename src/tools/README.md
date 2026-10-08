# tools

One file per tool, each calling `pi.registerTool({...})`:

```typescript
pi.registerTool({
  ...MY_TOOL_DEFINITION,
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    const resolved = resolveSandboxPath(ctx.cwd, params.path, "read"); // or "edit"
    const result = await myPlainFunction(resolved, params);
    return { content: [{ type: "text", text: renderResult(result) }], details: result };
  },
});
```

`resolveSandboxPath` (from `../sandbox.ts`) replaces `pathSafety.ts`'s `resolveSafePath` as the call every tool
makes — no tool file imports `pathSafety.ts` directly. It takes a `mode` (`"read"` or `"edit"`) so it can apply
mode-specific restricted-path rules (e.g. `.ssh`/`.git`/`.env`; currently identical between read and edit) on top of the underlying
root-containment check, and respects the `/toggle-sandbox` state (`on`/`off`). `find`/`grep`/`list`,
which walk a directory tree rather than resolving a single path, additionally filter each discovered entry
through `isEntrySandboxSafe(base, entryPath, mode, isSymlink)`.

Every file also exports a plain async function (`findFiles`, `grepFiles`, `listDir`, `editFile`, `makeDir`,
`removePath`, `copyFile`, `moveFile`, `lstatPath`, `insertText`, `readFile`, `peekFile`, `writeFile`, `gitStatus`,
`gitDiff`) that does the real work independent of `ExtensionAPI` — the tests in `../../tests` call these
directly instead of going through the tool wrapper.

`copy.ts`/`move.ts` each take a `source` and `destination`: `copyFile` only ever reads `source` (so only
`destination` is queued via `withFileMutationQueue`), while `moveFile` mutates both (queuing both, always in
the same lexically-sorted order so two moves swapping the same pair of paths can't deadlock on each other's
lock). `moveFile` tries `fs.rename` first and falls back to `fs.cp` + removing the source on `EXDEV`
(cross-filesystem moves). Both reuse `remove.ts`'s exported `removeRecursively` rather than duplicating its
signal-aware recursive-delete walk.

`grep.ts` is the exception: its actual scanning loop runs off the main thread in `grepWorker.ts`, since a
runaway regex can only be stopped by killing the thread it runs on, not by checking an `AbortSignal`.

`git_status.ts`/`git_diff.ts` are the other exception to the "pure filesystem" rule: they shell out to the
`git` CLI via `node:child_process`'s `execFile` (never a shell — arguments are passed as an array, so there's
no injection surface) with `cwd` pinned to the project root. Unlike `edit`/`insert`/`remove`/`write`, they
don't call `resolveSandboxPath` unconditionally — only when the caller passes a `path` to scope the
status/diff to, since with no `path` there's no caller-supplied path to validate in the first place.

`find`, `grep`, `edit`, `read`, and `write` share names with Pi's built-in tools, so registering them here
replaces the built-ins (per Pi's tool registry). `mkdir`, `remove`, `lstat`, `insert`, `git_status`, and
`git_diff` have no built-in name collision.

`peek.ts` never reads files itself: it calls `read.ts`'s `readProjectFile(root, target, {uncapped: true})`, the same sandboxed entry point `read`'s `execute()` uses, so the two tools can't diverge on sandboxing. It then delegates to `previewManagers/`: `registry.ts` maps file extensions to one `PreviewManager` per
language (`python.ts`, `typescript.ts`, `csharp.ts`, `markdown.ts`). Each manager's behavior is driven by the
regex table exported at the top of its file; TypeScript and C# share `braceEngine.ts`, a small
string/comment-aware brace and statement tracker. No user-supplied regex is involved, so (unlike `grep`) no
worker thread is needed.
