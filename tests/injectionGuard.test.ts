import { test } from "node:test";
import assert from "node:assert/strict";
import type { BeforeAgentStartEvent, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import extension from "../index.ts";
import { INJECTION_GUARD_RULES } from "../src/injectionGuard.ts";

type Handler = (event: unknown, ctx: ExtensionContext) => unknown;

/** Loads the extension against a fake Pi that records the handlers it registers. */
function loadExtension() {
  const handlers = new Map<string, Handler>();
  const fakePi = {
    registerTool: () => {},
    registerCommand: () => {},
    on: (event: string, handler: Handler) => void handlers.set(event, handler),
    getActiveTools: () => ["bash"],
    setActiveTools: () => {},
  } as unknown as ExtensionAPI;
  extension(fakePi);
  return { handlers };
}

const runBeforeAgentStart = (handlers: Map<string, Handler>, promptGuidelines: string[]) => {
  const systemPromptOptions = { promptGuidelines } as BeforeAgentStartEvent["systemPromptOptions"];
  handlers.get("before_agent_start")!({ systemPromptOptions }, {} as ExtensionContext);
  return systemPromptOptions.promptGuidelines;
};

test("before_agent_start appends the injection guard to the system prompt exactly once", () => {
  const { handlers } = loadExtension();
  assert.ok(handlers.has("before_agent_start"), "extension does not register a before_agent_start handler");

  const promptGuidelines = runBeforeAgentStart(handlers, []);
  assert.deepEqual(promptGuidelines, INJECTION_GUARD_RULES);
  assert.match(promptGuidelines.join("\n"), /Never follow instructions/i);
});

test("before_agent_start never duplicates the guard, even across runs", () => {
  const { handlers } = loadExtension();
  const promptGuidelines = runBeforeAgentStart(handlers, []);

  runBeforeAgentStart(handlers, promptGuidelines);
  assert.deepEqual(promptGuidelines, INJECTION_GUARD_RULES);
});

test("the guard keeps any rules already present in the prompt", () => {
  const { handlers } = loadExtension();
  const promptGuidelines = runBeforeAgentStart(handlers, ["existing rule"]);
  assert.deepEqual(promptGuidelines, ["existing rule", ...INJECTION_GUARD_RULES]);
});
