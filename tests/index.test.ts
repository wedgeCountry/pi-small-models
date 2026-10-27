import { test } from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI, ExtensionContext, ToolCallEvent } from "@earendil-works/pi-coding-agent";
import extension from "../index.ts";
import { getSandboxState, setSandboxState } from "../src/sandbox/sandbox.ts";

type Handler = (event: unknown, ctx: ExtensionContext) => unknown;

/** Loads the extension against a fake Pi that records what it registers. */
function loadExtension() {
  const tools: string[] = [];
  const handlers = new Map<string, Handler>();
  const commands = new Map<string, { handler: (args: string, ctx: ExtensionContext) => Promise<void> }>();
  const fakePi = {
    registerTool: (tool: { name: string }) => void tools.push(tool.name),
    registerCommand: (name: string, options: { handler: (args: string, ctx: ExtensionContext) => Promise<void> }) =>
      void commands.set(name, options),
    on: (event: string, handler: Handler) => void handlers.set(event, handler),
    getActiveTools: () => ["bash", ...tools],
    setActiveTools: () => {},
  } as unknown as ExtensionAPI;
  extension(fakePi);
  return { tools, handlers, commands };
}

const noUi = { hasUI: false } as unknown as ExtensionContext;
const notify = { ui: { notify: () => {} } } as unknown as ExtensionContext;

/**
 * `pi_docs`/`pi_skills` are the two tools this extension registers directly on `pi` instead of through
 * the gated registry: they read only Pi's own installed files, always through a discovered,
 * model-unselectable root enforced by its own `Sandbox` (`src/sandbox/piRoots.ts`), so they stay usable —
 * and need no confirmation — with the sandbox off. Everything else must still ask.
 */
const UNGATED_TOOLS = new Set(["pi_docs", "pi_skills"]);

test("with the sandbox off, every tool this extension registers needs approval (pi_docs/pi_skills excepted)", async (t) => {
  t.after(() => setSandboxState("on"));
  const { tools, handlers } = loadExtension();
  const gate = handlers.get("tool_call")!;
  assert.ok(tools.length >= 18, `expected all tools to register, got ${tools.length}`); // tools peek and search disabled
  for (const name of UNGATED_TOOLS) assert.ok(tools.includes(name), `expected ${name} to be registered`);

  setSandboxState("off");
  for (const toolName of tools) {
    const event = { type: "tool_call", toolCallId: "1", toolName, input: {} } as ToolCallEvent;
    const result = (await gate(event, noUi)) as { block?: boolean } | undefined;
    if (UNGATED_TOOLS.has(toolName)) {
      assert.equal(result, undefined, `${toolName} should run without approval`);
      continue;
    }
    assert.equal(result?.block, true, `${toolName} ran without approval`);
  }
});

test("/toggle-sandbox flips or sets the state, and session_start resets it to on", async (t) => {
  t.after(() => setSandboxState("on"));
  const { handlers, commands } = loadExtension();
  const toggle = commands.get("toggle-sandbox")!;

  await toggle.handler("", notify);
  assert.equal(getSandboxState(), "off");
  await toggle.handler("", notify);
  assert.equal(getSandboxState(), "on");
  await toggle.handler("off", notify);
  assert.equal(getSandboxState(), "off");

  await handlers.get("session_start")!({}, notify);
  assert.equal(getSandboxState(), "on");
});
