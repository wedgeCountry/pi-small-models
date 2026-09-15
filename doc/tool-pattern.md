# Tool pattern

A guide for adding a new tool to this project, aimed at LLM agents working in this repo. For full
detail on any one tool, or on sandboxing/cancellation/testing, see [`CLAUDE.md`](../CLAUDE.md).

## The split

Each tool is two files that must stay in sync:

**1. `src/tool_definitions/<tool>.ts`** — pure data, no logic:
- `name`, `label`, `description` — shown to the model in the tool list
- `promptSnippet` (one-liner) / `promptGuidelines` (bullet list) — extra instructions injected into
  the model's context about when/how to use this tool
- `parameters` — a typebox `Type.Object({...})` schema

**2. `src/tools/<tool>.ts`** — two exports:
- A **plain async function** (`makeDir`, `readFile`, `editFile`, ...) that does the real work: plain
  arguments (paths, strings, an `{signal}` options bag), no `ExtensionAPI` involved. This is what
  `src/tests/*.test.ts` calls directly — no mock harness needed.
- A **`registerXTool(pi)`** function that spreads the `*_TOOL_DEFINITION` into `pi.registerTool({...})`,
  adds a `renderCall` (how the call renders in the UI), and an `execute()` that:
  1. resolves/sandboxes the path via `resolveSandboxPath(ctx.cwd, params.path, mode)`
  2. calls the plain function
  3. wraps the result as `{content: [...], details: {...}}`

`index.ts` just imports every `registerXTool` and calls them all in its default export. Nothing tool-specific
lives in `index.ts` — it only does global-level things once (filtering `bash` out of active tools, registering
slash commands, wiring `permissionGate` on `pi.on("tool_call", ...)`).

## Why the split

- The definition is reusable/inspectable data (schema, prompt copy) kept separate from behavior.
- The plain function is unit-testable without spinning up the extension/agent runtime.
- `registerXTool` is the only place touching `ExtensionAPI`, sandboxing, and result-shaping — keeping
  cross-cutting concerns out of the core logic.

## Minimal template: adding a `touch` tool

`src/tool_definitions/touch.ts`:
```ts
import { Type } from "typebox";

export const TOUCH_TOOL_DEFINITION = {
  name: "touch",
  label: "Touch",
  description: "Create an empty file within the project, including any missing parent directories.",
  promptSnippet: "touch: create an empty file, including missing parents (bash is disabled)",
  promptGuidelines: [
    "Use touch to create a new empty file. Missing parent directories are created automatically.",
    "Use touch instead of a bash `touch` command — bash is disabled in this project.",
  ],
  parameters: Type.Object({
    path: Type.String({ description: "File to create, relative to the project root." }),
  }),
};
```

`src/tools/touch.ts`:
```ts
import * as fs from "node:fs/promises";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { TOUCH_TOOL_DEFINITION } from "../tool_definitions/touch.ts";
import { resolveSandboxPath } from "../sandbox.ts";
import { oneLine, callName } from "../renderCall.ts";

export interface TouchOptions {
  signal?: AbortSignal;
}

// Plain function: no ExtensionAPI, directly unit-testable.
export async function touchFile(filePath: string, opts: TouchOptions = {}): Promise<void> {
  opts.signal?.throwIfAborted();
  const handle = await fs.open(filePath, "a");
  await handle.close();
}

export function registerTouchTool(pi: ExtensionAPI) {
  pi.registerTool({
    ...TOUCH_TOOL_DEFINITION,
    renderCall(args, theme) {
      return oneLine(`${callName(theme, "touch")} ${theme.fg("accent", args.path ?? "")}`);
    },
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const filePath = resolveSandboxPath(ctx.cwd, params.path, "edit"); // "read" for non-mutating tools
      await touchFile(filePath, { signal });

      return {
        content: [{ type: "text", text: `Created ${params.path}.` }],
        details: {},
      };
    },
  });
}
```

`index.ts` wiring:
```ts
import { registerTouchTool } from "./src/tools/touch.ts";
// ...
export default function (pi: ExtensionAPI) {
  registerTouchTool(pi);
  // ...other registerXTool(pi) calls
}
```

Test (`src/tests/touch.test.ts`) calls `touchFile()` directly against a fixture dir from
`src/tests/fixtures.ts`, bypassing `pi.registerTool` entirely.

## Checklist for a new tool

- Pick `mode: "read"` or `"edit"` for `resolveSandboxPath` based on whether it mutates the filesystem.
- If it mutates an existing file, wrap the read-modify-write in `withFileMutationQueue`
  (`src/mutationQueue.ts`).
- If it can run long (globbing, recursive walk, big regex), thread `AbortSignal` through and honor it —
  see the Cancellation section of `CLAUDE.md` for the pattern per syscall type.
- Add the plain function's unit test under `src/tests/`.
- Don't collide with a Pi built-in tool name unless you intend to replace it (`find`/`grep`/`edit`/`read`/
  `write` do this deliberately).
