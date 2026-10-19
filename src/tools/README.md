# Tools

Each tool has two parts:

## 1. Registration File
Exports a `registerMyTool()` function that calls `pi.registerTool()` with the tool definition and an `execute()` function.

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
```

## 2. Plain Async Function
Each tool exports a plain function (`findFiles`, `grepFiles`, `listDir`, etc.) that:
- Takes a `Sandbox` as the first argument
- Does the actual work
- Never checks paths directly — delegates to the sandbox

Tests call these plain functions directly with `new Sandbox(fixtureDir)`.

## Available Tools
`find`, `grep`, `edit`, `read`, `write`, `mkdir`, `remove`, `copy`, `move`, `lstat`, `insert`, `list`, `git_status`, `git_diff`

## Special Cases
- **grep**: Runs in a worker thread (`grepWorker.mjs`) — can be killed to stop runaway regex
- **git_status/git_diff**: Shell out to `git` CLI via `execFile` (no shell injection possible)
- **find/grep/edit/read/write**: Replace Pi built-ins
