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

test("with the sandbox off, every tool this extension registers needs approval", async (t) => {
  t.after(() => setSandboxState("on"));
  const { tools, handlers } = loadExtension();
  const gate = handlers.get("tool_call")!;
  assert.ok(tools.length >= 26, `expected all tools to register, got ${tools.length}`);

  setSandboxState("off");
  for (const toolName of tools) {
    const event = { type: "tool_call", toolCallId: "1", toolName, input: {} } as ToolCallEvent;
    const result = (await gate(event, noUi)) as { block?: boolean } | undefined;
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
