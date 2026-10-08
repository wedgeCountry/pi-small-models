# tools

One file per tool, each registering it through the `ToolRegistry` that `index.ts` passes in:

```typescript
export function registerMyTool(pi: ToolRegistry) {
  pi.registerTool({
    ...MY_TOOL_DEFINITION,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const result = await myPlainFunction(sandboxFor(ctx.cwd), params.path, { signal });
      return { content: [{ type: "text", text: renderResult(result) }], details: result };
    },
  });
}

export async function myPlainFunction(sb: Sandbox, target: string, opts: MyOptions = {}) {
  const filePath = sb.resolve(target); // throws SandboxError if not allowed
  // ...
}
```

Every file exports a plain async function (`findFiles`, `grepFiles`, `listDir`, `editFile`, `makeDir`,
`removePath`, `copyFile`, `moveFile`, `lstatPath`, `insertText`, `readFile`, `peekFile`, `writeFile`, `gitStatus`,
`gitDiff`, …) that takes a `Sandbox` first and does the real work independent of Pi. Tool code never checks
paths itself: it asks the sandbox (`../sandbox/sandbox.ts`). A model-supplied path goes through `sb.resolve`;
a path handed to a child process through `sb.relative`; entries a directory walk discovers through
`sb.entryFilter(base)`; paths reported by `git` through `sb.allowsReported`; files inside installed packages
through `sb.resolveLibraryFile`. Tests call the plain functions with `new Sandbox(fixtureDir)` (or
`new Sandbox(dir, false)` for the unenforced case), so they exercise the same path production runs.

`copy.ts`/`move.ts` each take a `source` and `destination`: `copyFile` only ever reads `source` (so only
`destination` is queued via `withFileMutationQueue`), while `moveFile` mutates both (queuing both, always in
the same lexically-sorted order so two moves swapping the same pair of paths can't deadlock on each other's
lock). `moveFile` tries `fs.rename` first and falls back to `fs.cp` + removing the source on `EXDEV`
(cross-filesystem moves). Both reuse `remove.ts`'s exported `removeRecursively` rather than duplicating its
signal-aware recursive-delete walk.

`grep.ts` is the exception: its actual scanning loop runs off the main thread in `grepWorker.mjs`, since a
runaway regex can only be stopped by killing the thread it runs on, not by checking an `AbortSignal`. The
worker knows no sandbox rules: it reads only the files the main thread's `entryFilter` approved.

`git_status.ts`/`git_diff.ts` are the other exception to the "pure filesystem" rule: they shell out to the
`git` CLI via `node:child_process`'s `execFile` (never a shell — arguments are passed as an array, so there's
no injection surface) with `cwd` pinned to the project root. An optional `path` scope goes through
`sb.relative`, and every path in git's output is filtered through `sb.allowsReported`.

`find`, `grep`, `edit`, `read`, and `write` share names with Pi's built-in tools, so registering them here
replaces the built-ins (per Pi's tool registry). `mkdir`, `remove`, `lstat`, `insert`, `git_status`, and
`git_diff` have no built-in name collision.

`peek.ts` never reads files itself: it calls `read.ts`'s `readFile(sb, target, {uncapped: true})`, the same function `read`'s `execute()` uses, so the two tools can't diverge on sandboxing. It then delegates to `previewManagers/`: `registry.ts` maps file extensions to one `PreviewManager` per
language (`python.ts`, `typescript.ts`, `csharp.ts`, `markdown.ts`). Each manager's behavior is driven by the
regex table exported at the top of its file; TypeScript and C# share `braceEngine.ts`, a small
string/comment-aware brace and statement tracker. No user-supplied regex is involved, so (unlike `grep`) no
worker thread is needed.
