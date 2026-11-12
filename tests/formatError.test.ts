import { test } from "node:test";
import assert from "node:assert/strict";
import { formatError, toolError, capErrors, setDebugMode, isDebugMode } from "../src/backend/formatError.ts";

test("debug off (default): errors carry just the message, no Parameters line", (t) => {
  t.after(() => setDebugMode(false));
  setDebugMode(false);
  assert.equal(isDebugMode(), false);
  assert.equal(
    formatError("read", 'Could not read file "a.ts": not found', { path: "a.ts", offset: 1, limit: 10 }),
    'read error: Could not read file "a.ts": not found'
  );
  assert.equal(formatError("mkdir", "Aborted"), "mkdir error: Aborted");
  assert.equal(formatError("mkdir", "Aborted", {}), "mkdir error: Aborted");
});

test("debug on: the Parameters line lists the supplied arguments", (t) => {
  t.after(() => setDebugMode(false));
  setDebugMode(true);
  const message = formatError("read", 'Could not read file "a.ts": not found', { path: "a.ts", offset: 1, limit: 10 });
  assert.equal(message, 'read error: Could not read file "a.ts": not found\nParameters: path="a.ts", offset=1, limit=10');
});

test("debug on: no Parameters line when no active parameters are given", (t) => {
  t.after(() => setDebugMode(false));
  setDebugMode(true);
  assert.equal(formatError("mkdir", "Aborted"), "mkdir error: Aborted");
  assert.equal(formatError("mkdir", "Aborted", {}), "mkdir error: Aborted");
});

test("debug on: skips undefined values, functions, and AbortSignals from the parameter list", (t) => {
  t.after(() => setDebugMode(false));
  setDebugMode(true);
  const message = formatError("edit", "oldText not found", {
    path: "a.ts",
    limit: undefined,
    signal: new AbortController().signal,
    fn: () => {},
  });
  assert.equal(message, 'edit error: oldText not found\nParameters: path="a.ts"');
});

test("debug on: truncates long parameter values", (t) => {
  t.after(() => setDebugMode(false));
  setDebugMode(true);
  const message = formatError("write", "Could not write file", { path: "a.ts", content: "x".repeat(500) });
  assert.match(message, /content="x{100,}/);
  assert.ok(message.length < 300);
});

test("capErrors truncates long errors when debug is off, keeps them whole when on", (t) => {
  t.after(() => setDebugMode(false));
  const huge = "x".repeat(10 * 1024);

  setDebugMode(false);
  const capped = capErrors(`read error: ${huge}`);
  assert.ok(capped.length < huge.length, "error is trimmed in default mode");
  assert.match(capped, /\[Error truncated\..*--debug/);

  setDebugMode(true);
  assert.equal(capErrors(`read error: ${huge}`), `read error: ${huge}`);
});

test("toolError returns an Error with the formatted message", (t) => {
  t.after(() => setDebugMode(false));
  setDebugMode(true);
  const err = toolError("copy", "Source and destination are the same path", { path: "a.ts", destination: "a.ts" });
  assert.ok(err instanceof Error);
  assert.equal(err.message, 'copy error: Source and destination are the same path\nParameters: path="a.ts", destination="a.ts"');
});
