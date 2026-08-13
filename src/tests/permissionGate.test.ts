import { test } from "node:test";
import assert from "node:assert/strict";
import type { ExtensionContext, ToolCallEvent } from "@earendil-works/pi-coding-agent";
import { describeToolCall, gateToolCall } from "../permissionGate.ts";
import { setSandboxState } from "../sandbox.ts";

function makeEvent(toolName: string, input: Record<string, unknown>): ToolCallEvent {
  return { type: "tool_call", toolCallId: "test-call", toolName, input } as ToolCallEvent;
}

function makeContext(hasUI: boolean, confirmResult: boolean): { ctx: ExtensionContext; calls: { confirm: number } } {
  const calls = { confirm: 0 };
  const ctx = {
    hasUI,
    ui: {
      confirm: async () => {
        calls.confirm++;
        return confirmResult;
      },
    },
  } as unknown as ExtensionContext;
  return { ctx, calls };
}

test("describeToolCall formats each tool's input", () => {
  assert.equal(describeToolCall("read", { path: "src/index.ts" }), "read src/index.ts");
  assert.equal(describeToolCall("write", { path: "src/index.ts" }), "write src/index.ts");
  assert.equal(describeToolCall("edit", { path: "src/index.ts" }), "edit src/index.ts");
  assert.equal(describeToolCall("mkdir", { path: "src/newdir" }), "mkdir src/newdir");
  assert.equal(describeToolCall("lstat", { path: "src/index.ts" }), "lstat src/index.ts");

  assert.equal(describeToolCall("remove", { path: "build" }), "remove build");
  assert.equal(describeToolCall("remove", { path: "build", recursive: true }), "remove build (recursive)");

  assert.equal(describeToolCall("list", {}), "list .");
  assert.equal(describeToolCall("list", { path: "src" }), "list src");
  assert.equal(describeToolCall("list", { path: "src", recursive: true }), "list src (recursive)");

  assert.equal(describeToolCall("insert", { path: "src/index.ts", line: 12 }), "insert into src/index.ts after line 12");
  assert.equal(describeToolCall("insert", { path: "src/index.ts" }), "insert into src/index.ts");

  assert.equal(describeToolCall("find", { pattern: "**/*.ts" }), 'find "**/*.ts"');
  assert.equal(describeToolCall("find", { pattern: "**/*.ts", path: "src" }), 'find "**/*.ts" in src');
  assert.equal(describeToolCall("grep", { pattern: "TODO", path: "src" }), 'grep "TODO" in src');

  assert.equal(describeToolCall("git_status", {}), "git_status");
  assert.equal(describeToolCall("git_status", { path: "src" }), "git_status (src)");
  assert.equal(describeToolCall("git_diff", { path: "src" }), "git_diff (src)");

  assert.equal(describeToolCall("unknown_tool", { path: "src" }), "unknown_tool");
});

test("describeToolCall never throws on malformed or missing fields", () => {
  assert.doesNotThrow(() => describeToolCall("read", {}));
  assert.doesNotThrow(() => describeToolCall("read", { path: 42 }));
  assert.doesNotThrow(() => describeToolCall("insert", { path: 42, line: "twelve" }));
  assert.equal(describeToolCall("read", { path: 42 }), "read ?");
});

test("gateToolCall lets everything through while sandbox is on, without prompting", async (t) => {
  t.after(() => setSandboxState("on"));
  setSandboxState("on");

  const { ctx, calls } = makeContext(true, false); // confirm would deny, but should never be called
  const result = await gateToolCall(makeEvent("read", { path: "src/index.ts" }), ctx);
  assert.equal(result, undefined);
  assert.equal(calls.confirm, 0);
});

test("gateToolCall ignores tool names this project doesn't register, even while off", async (t) => {
  t.after(() => setSandboxState("on"));
  setSandboxState("off");

  const { ctx, calls } = makeContext(true, false);
  const result = await gateToolCall(makeEvent("bash", { command: "git push" }), ctx);
  assert.equal(result, undefined);
  assert.equal(calls.confirm, 0);
});

test("gateToolCall allows a gated call while off when the user confirms", async (t) => {
  t.after(() => setSandboxState("on"));
  setSandboxState("off");

  const { ctx } = makeContext(true, true);
  const result = await gateToolCall(makeEvent("read", { path: "src/index.ts" }), ctx);
  assert.equal(result, undefined);
});

test("gateToolCall blocks a gated call while off when the user declines", async (t) => {
  t.after(() => setSandboxState("on"));
  setSandboxState("off");

  const { ctx } = makeContext(true, false);
  const result = await gateToolCall(makeEvent("write", { path: "src/index.ts", content: "x" }), ctx);
  assert.deepEqual(result, { block: true, reason: "Denied by user (sandbox is off): write" });
});

test("gateToolCall blocks a gated call while off without prompting when no UI is available", async (t) => {
  t.after(() => setSandboxState("on"));
  setSandboxState("off");

  const { ctx, calls } = makeContext(false, true);
  const result = await gateToolCall(makeEvent("read", { path: "src/index.ts" }), ctx);
  assert.equal((result as { block?: boolean } | undefined)?.block, true);
  assert.equal(calls.confirm, 0);
});
