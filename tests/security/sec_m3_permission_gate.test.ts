/**
 * Pentest — Finding M3 (Medium): the permission gate under-describes calls and ignores executing
 * tools when the sandbox is ON.
 *
 * (a) `describeToolCall` shows only a path for mutating tools (no content/diff), and falls through
 *     to the bare tool name for `dotnet_build` / `dotnet_list` / `ts_check` — which execute code.
 * (b) `createPermissionGate` does nothing while the sandbox is ON, so the executing tools run with
 *     no approval at all in the default mode (this is the gate half of Findings C1–C3).
 *
 * Secure expectations below FAIL today.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ExtensionContext, ToolCallEvent } from "@earendil-works/pi-coding-agent";
import { describeToolCall, createPermissionGate } from "../../src/sandbox/permissionGate.ts";
import { setSandboxState } from "../../src/sandbox/sandbox.ts";

test("M3a: describeToolCall for `write` should convey what will change, not just the path", () => {
  const text = describeToolCall("write", { path: "notes.txt", content: "a".repeat(4096) });
  assert.notEqual(
    text.trim(),
    "write notes.txt",
    "SECURITY/UX: the approval prompt for `write` shows only the path, so a user cannot see what is being written"
  );
});

test("M3a: executing tools must not fall through to a bare tool name in the approval prompt", () => {
  for (const tool of ["dotnet_build", "dotnet_list", "ts_check"]) {
    const text = describeToolCall(tool, { path: "." });
    assert.notEqual(
      text.trim(),
      tool,
      `SECURITY: the approval prompt for "${tool}" shows only its name, hiding that it executes code / a build`
    );
  }
});

test("M3b: an executing tool must still be gated when the sandbox is ON", async () => {
  setSandboxState("on");
  try {
    const gate = createPermissionGate(new Set(["dotnet_build"]));
    const event = { toolName: "dotnet_build", input: { path: "." } } as unknown as ToolCallEvent;
    const ctx = { hasUI: false } as unknown as ExtensionContext;
    const result = await gate(event, ctx);
    assert.ok(
      result && (result as { block?: boolean }).block === true,
      "SECURITY: dotnet_build was allowed to run with no approval while the sandbox was ON"
    );
  } finally {
    setSandboxState("on");
  }
});
