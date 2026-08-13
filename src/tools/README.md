# tools

One file per tool, each calling `pi.registerTool({...})`:

```typescript
pi.registerTool({
  ...MY_TOOL_DEFINITION,
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    const resolved = resolveSafePath(ctx.cwd, params.path);
    const result = await myPlainFunction(resolved, params);
    return { content: [{ type: "text", text: renderResult(result) }], details: result };
  },
});
```

Every file also exports a plain async function (`findFiles`, `grepFiles`, `listDir`, `editFile`, `makeDir`,
`removePath`, `lstatPath`, `insertText`, `readFile`, `writeFile`) that does the real work independent of
`ExtensionAPI` — the tests in `../tests/` call these directly instead of going through the tool wrapper.

`grep.ts` is the exception: its actual scanning loop runs off the main thread in `grepWorker.ts`, since a
runaway regex can only be stopped by killing the thread it runs on, not by checking an `AbortSignal`.

`find`, `grep`, `edit`, `read`, and `write` share names with Pi's built-in tools, so registering them here
replaces the built-ins (per Pi's tool registry). `mkdir`, `remove`, `lstat`, and `insert` have no built-in
name collision.
