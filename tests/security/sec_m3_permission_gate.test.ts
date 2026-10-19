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
import { describeToolCall, createPermissionGate } from "../../src/sandbox/permissionGate.ts";

test("M3a: describeToolCall for `write` should convey what will change, not just the path", () => {
  const text = describeToolCall("write", { path: "notes.txt", content: "a".repeat(4096) });
  assert.notEqual(
    text.trim(),
    "write notes.txt",
    "SECURITY/UX: the approval prompt for `write` shows only the path, so a user cannot see what is being written"
  );
});
