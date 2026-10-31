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
- `registerXTool(pi)` — builds the tool with `createTool(definition, hooks)` (`src/backend/createTool.ts`) and registers it through the gated registry

`index.ts` imports and calls all `registerXTool` functions.

## Injection guard

Prompt-injection defense lives in `src/injectionGuard.ts` and is injected **once** into the system
prompt's rules by `index.ts` via a `before_agent_start` handler
(`systemPromptOptions.promptGuidelines` — Pi renders these as the `rules` section), not duplicated
into each tool's `promptGuidelines`. Keep `tests/injectionGuard.test.ts` green — it fails if the
handler stops appending the rules or duplicates them.

## Minimal template

`src/tool_definitions/touch.ts`:
```ts
import { Type } from "typebox";

export const TOUCH_TOOL_DEFINITION = {
  name: "touch",
  label: "Touch",
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
import { renderLine } from "../backend/renderCall.ts";
import { createTool } from "../backend/createTool.ts";
import type { ToolRegistry } from "../sandbox/permissionGate.ts";

export async function touchFile(sb: Sandbox, target: string): Promise<void> {
  const filePath = sb.resolve(target);
  // implementation here
}

export function registerTouchTool(pi: ToolRegistry) {
  pi.registerTool(
    createTool(TOUCH_TOOL_DEFINITION, {
      renderCall: (args, theme) => renderLine(theme, "touch", args.path),
      async execute(params, { signal, cwd }) {
        await touchFile(sandboxFor(cwd), params.path);
        return { content: [{ type: "text", text: `Created ${params.path}.` }], details: {} };
      },
    })
  );
}
```

## Checklist

- Take `Sandbox` first, resolve paths with `sb.resolve`
- Mutating files? Wrap in `withFileMutationQueue`
- Long-running? Thread `AbortSignal` through
- Add unit test calling plain function directly
