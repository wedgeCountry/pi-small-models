# Tool pattern

A guide for adding tools to this project.

## The split

Each tool has two files:

**1. `src/tool_definitions/<tool>.ts`** — definition only:
- `name`, `label`, `description`
- `promptSnippet` / `promptGuidelines`
- `parameters` — typebox schema

**2. `src/tools/<tool>.ts`** — two exports:
- Plain async function (`toolName`) — takes `Sandbox` first, then args
- `registerXTool(pi)` — registers with `pi.registerTool`, calls plain function via sandbox

`index.ts` imports and calls all `registerXTool` functions.

## Minimal template

`src/tool_definitions/touch.ts`:
```ts
import { Type } from "typebox";

export const TOUCH_TOOL_DEFINITION = {
  name: "touch",
  description: "Create an empty file.",
  promptSnippet: "touch: create empty file, includes missing parents",
  parameters: Type.Object({
    path: Type.String({ description: "File to create" }),
  }),
};
```

`src/tools/touch.ts`:
```ts
import { TOUCH_TOOL_DEFINITION } from "../tool_definitions/touch.ts";
import { sandboxFor, type Sandbox } from "../sandbox/sandbox.ts";
import type { ToolRegistry } from "../sandbox/permissionGate.ts";

export async function touchFile(sb: Sandbox, target: string): Promise<void> {
  const filePath = sb.resolve(target);
  // implementation here
}

export function registerTouchTool(pi: ToolRegistry) {
  pi.registerTool({
    ...TOUCH_TOOL_DEFINITION,
    renderCall(args, theme) { return `touch ${args.path}`; },
    async execute(_id, params, signal, _onUpdate, ctx) {
      await touchFile(sandboxFor(ctx.cwd), params.path, { signal });
      return { content: [{ type: "text", text: `Created ${params.path}.` }], details: {} };
    },
  });
}
```

## Checklist

- Take `Sandbox` first, resolve paths with `sb.resolve`
- Mutating files? Wrap in `withFileMutationQueue`
- Long-running? Thread `AbortSignal` through
- Add unit test calling plain function directly
