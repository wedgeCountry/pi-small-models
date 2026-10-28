import { test } from "node:test";
import assert from "node:assert/strict";
import { formatError, toolError } from "../src/backend/formatError.ts";

test("formats a message with the tool name prefix and parameter list", () => {
  const message = formatError("read", "Could not read file \"a.ts\": not found", { path: "a.ts", offset: 1, limit: 10 });
  assert.equal(message, 'read error: Could not read file "a.ts": not found\nParameters: path="a.ts", offset=1, limit=10');
});

test("omits the Parameters line when no active parameters are given", () => {
  assert.equal(formatError("mkdir", "Aborted"), "mkdir error: Aborted");
  assert.equal(formatError("mkdir", "Aborted", {}), "mkdir error: Aborted");
});

test("skips undefined values, functions, and AbortSignals from the parameter list", () => {
  const message = formatError("edit", "oldText not found", {
    path: "a.ts",
    limit: undefined,
    signal: new AbortController().signal,
    fn: () => {},
  });
  assert.equal(message, 'edit error: oldText not found\nParameters: path="a.ts"');
});

test("truncates long parameter values", () => {
  const message = formatError("write", "Could not write file", { path: "a.ts", content: "x".repeat(500) });
  assert.match(message, /content="x{100,}/);
  assert.ok(message.length < 300);
});

test("toolError returns an Error with the formatted message", () => {
  const err = toolError("copy", "Source and destination are the same path", { path: "a.ts", destination: "a.ts" });
  assert.ok(err instanceof Error);
  assert.equal(err.message, 'copy error: Source and destination are the same path\nParameters: path="a.ts", destination="a.ts"');
});
