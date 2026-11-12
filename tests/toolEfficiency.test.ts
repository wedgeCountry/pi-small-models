import { test } from "node:test";
import assert from "node:assert/strict";
import type { BeforeAgentStartEvent, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import extension from "../index.ts";
import { TOOL_EFFICIENCY_GUIDELINES } from "../src/toolEfficiency.ts";
import { INJECTION_GUARD_RULES } from "../src/injectionGuard.ts";

type Handler = (event: unknown, ctx: ExtensionContext) => unknown;

/** Loads the extension against a fake Pi that records the handlers it registers. */
function loadExtension() {
  const handlers = new Map<string, Handler>();
  const fakePi = {
    registerTool: () => {},
    registerCommand: () => {},
    registerFlag: () => {},
    getFlag: () => undefined,
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

test("before_agent_start appends the tool-efficiency guidelines exactly once, alongside the injection guard", () => {
  const { handlers } = loadExtension();
  const promptGuidelines = runBeforeAgentStart(handlers, []);

  for (const rule of TOOL_EFFICIENCY_GUIDELINES) {
    assert.ok(promptGuidelines.includes(rule), `missing guideline: ${rule}`);
  }
  assert.match(promptGuidelines.join("\n"), /peek.*ultima ratio/i);
  assert.match(promptGuidelines.join("\n"), /find_usages/);
  assert.deepEqual(promptGuidelines.slice(0, INJECTION_GUARD_RULES.length), INJECTION_GUARD_RULES);

  runBeforeAgentStart(handlers, promptGuidelines);
  assert.equal(promptGuidelines.length, INJECTION_GUARD_RULES.length + TOOL_EFFICIENCY_GUIDELINES.length, "no duplicates on re-run");
});
