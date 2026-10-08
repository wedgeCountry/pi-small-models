import { test } from "node:test";
import assert from "node:assert/strict";
import type { ExtensionContext, ToolCallEvent } from "@earendil-works/pi-coding-agent";
import { createGatedRegistry, createPermissionGate, describeToolCall } from "../src/sandbox/permissionGate.ts";
import { setSandboxState } from "../src/sandbox/sandbox.ts";

const gateToolCall = createPermissionGate(new Set(["read", "write", "copy", "move"]));

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

  assert.equal(describeToolCall("copy", { path: "a.txt", destination: "b.txt" }), "copy a.txt -> b.txt");
  assert.equal(
    describeToolCall("move", { path: "src", destination: "dest", recursive: true }),
    "move src -> dest (recursive)"
  );

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

test("gateToolCall ignores tool names it wasn't given, even while off", async (t) => {
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

test("gateToolCall gates copy and move while off, same as the other tools this project registers", async (t) => {
  t.after(() => setSandboxState("on"));
  setSandboxState("off");

  const { ctx: denyCtx } = makeContext(true, false);
  assert.deepEqual(await gateToolCall(makeEvent("copy", { path: "a.txt", destination: "b.txt" }), denyCtx), {
    block: true,
    reason: "Denied by user (sandbox is off): copy",
  });

  const { ctx: allowCtx } = makeContext(true, true);
  assert.equal(await gateToolCall(makeEvent("move", { path: "a.txt", destination: "b.txt" }), allowCtx), undefined);
});

test("gateToolCall blocks a gated call while off without prompting when no UI is available", async (t) => {
  t.after(() => setSandboxState("on"));
  setSandboxState("off");

  const { ctx, calls } = makeContext(false, true);
  const result = await gateToolCall(makeEvent("read", { path: "src/index.ts" }), ctx);
  assert.equal((result as { block?: boolean } | undefined)?.block, true);
  assert.equal(calls.confirm, 0);
});

test("createGatedRegistry forwards every registration and gates exactly the registered names", async (t) => {
  t.after(() => setSandboxState("on"));
  const forwarded: string[] = [];
  const { registry, gatedTools } = createGatedRegistry({
    registerTool: (tool) => {
      forwarded.push(tool.name);
    },
  });
  registry.registerTool({ name: "dotnet_build" } as Parameters<typeof registry.registerTool>[0]);
  registry.registerTool({ name: "npm_list" } as Parameters<typeof registry.registerTool>[0]);

  assert.deepEqual(forwarded, ["dotnet_build", "npm_list"]);
  assert.deepEqual([...gatedTools], ["dotnet_build", "npm_list"]);

  setSandboxState("off");
  const gate = createPermissionGate(gatedTools);
  const { ctx } = makeContext(false, true);
  assert.equal((await gate(makeEvent("dotnet_build", {}), ctx) as { block?: boolean } | undefined)?.block, true);
  assert.equal(await gate(makeEvent("bash", {}), ctx), undefined);
});
