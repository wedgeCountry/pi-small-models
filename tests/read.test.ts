import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { readFile } from "../src/tools/read.ts";
import { makeFixture, cleanupFixture } from "./fixtures.ts";
import { Sandbox } from "../src/sandbox/sandbox.ts";

test("reads a whole file as 1-indexed lines", async (t) => {
  const dir = await makeFixture({ "a.txt": "line1\nline2\nline3" });
  t.after(() => cleanupFixture(dir));

  const result = await readFile(new Sandbox(dir), path.join(dir, "a.txt"));
  assert.deepEqual(result.lines, [
    { line: 1, text: "line1" },
    { line: 2, text: "line2" },
    { line: 3, text: "line3" },
  ]);
  assert.equal(result.totalLines, 3);
  assert.equal(result.truncated, false);
});

test("honors offset", async (t) => {
  const dir = await makeFixture({ "a.txt": "line1\nline2\nline3" });
  t.after(() => cleanupFixture(dir));

  const result = await readFile(new Sandbox(dir), path.join(dir, "a.txt"), { offset: 2 });
  assert.deepEqual(result.lines, [
    { line: 2, text: "line2" },
    { line: 3, text: "line3" },
  ]);
  assert.equal(result.truncated, false);
});

test("honors limit and reports truncation with a continuation offset", async (t) => {
  const dir = await makeFixture({ "a.txt": "line1\nline2\nline3" });
  t.after(() => cleanupFixture(dir));

  const result = await readFile(new Sandbox(dir), path.join(dir, "a.txt"), { limit: 2 });
  assert.deepEqual(result.lines, [
    { line: 1, text: "line1" },
    { line: 2, text: "line2" },
  ]);
  assert.equal(result.totalLines, 3);
  assert.equal(result.truncated, true);
});

test("combines offset and limit", async (t) => {
  const dir = await makeFixture({ "a.txt": "line1\nline2\nline3\nline4" });
  t.after(() => cleanupFixture(dir));

  const result = await readFile(new Sandbox(dir), path.join(dir, "a.txt"), { offset: 2, limit: 2 });
  assert.deepEqual(result.lines, [
    { line: 2, text: "line2" },
    { line: 3, text: "line3" },
  ]);
  assert.equal(result.truncated, true);
});

test("is not truncated when limit reaches exactly the end of the file", async (t) => {
  const dir = await makeFixture({ "a.txt": "line1\nline2\nline3" });
  t.after(() => cleanupFixture(dir));

  const result = await readFile(new Sandbox(dir), path.join(dir, "a.txt"), { limit: 3 });
  assert.equal(result.lines.length, 3);
  assert.equal(result.truncated, false);
});

test("splits lines the same way insert does, so line numbers agree across tools", async (t) => {
  const dir = await makeFixture({ "a.txt": "line1\r\nline2\r\nline3" });
  t.after(() => cleanupFixture(dir));

  const result = await readFile(new Sandbox(dir), path.join(dir, "a.txt"));
  assert.deepEqual(
    result.lines.map((l) => l.text),
    ["line1", "line2", "line3"]
  );
});

test("caps output at DEFAULT_MAX_LINES lines even without an explicit limit", async (t) => {
  const lines = Array.from({ length: 2005 }, (_, i) => `line${i + 1}`);
  const dir = await makeFixture({ "a.txt": lines.join("\n") });
  t.after(() => cleanupFixture(dir));

  const result = await readFile(new Sandbox(dir), path.join(dir, "a.txt"));
  assert.equal(result.lines.length, 2000);
  assert.equal(result.totalLines, 2005);
  assert.equal(result.truncated, true);
});

test("rejects an offset beyond the end of the file", async (t) => {
  const dir = await makeFixture({ "a.txt": "line1\nline2" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(() => readFile(new Sandbox(dir), path.join(dir, "a.txt"), { offset: 3 }));
});

test("rejects a non-positive offset", async (t) => {
  const dir = await makeFixture({ "a.txt": "line1" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(() => readFile(new Sandbox(dir), path.join(dir, "a.txt"), { offset: 0 }));
});

test("rejects a non-positive limit", async (t) => {
  const dir = await makeFixture({ "a.txt": "line1" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(() => readFile(new Sandbox(dir), path.join(dir, "a.txt"), { limit: 0 }));
});

test("rejects when the file does not exist", async (t) => {
  const dir = await makeFixture({});
  t.after(() => cleanupFixture(dir));

  await assert.rejects(() => readFile(new Sandbox(dir), path.join(dir, "missing.txt")));
});

test("rejects when the signal is already aborted", async (t) => {
  const dir = await makeFixture({ "a.txt": "line1" });
  t.after(() => cleanupFixture(dir));

  const ac = new AbortController();
  ac.abort();
  await assert.rejects(() => readFile(new Sandbox(dir), path.join(dir, "a.txt"), { signal: ac.signal }));
});

test("uncapped (internal option) returns every line past the 2000-line cap", async (t) => {
  const dir = await makeFixture({ "big.txt": Array.from({ length: 2500 }, (_, i) => `l${i}`).join("\n") });
  t.after(() => cleanupFixture(dir));

  const capped = await readFile(new Sandbox(dir), path.join(dir, "big.txt"));
  assert.equal(capped.lines.length, 2000);
  const full = await readFile(new Sandbox(dir), path.join(dir, "big.txt"), { uncapped: true });
  assert.equal(full.lines.length, 2500);
  assert.equal(full.truncated, false);
});

test("readFile resolves the path through the sandbox before reading", async (t) => {
  const dir = await makeFixture({ "a.txt": "hello", ".env": "SECRET=1" });
  t.after(() => cleanupFixture(dir));

  const ok = await readFile(new Sandbox(dir), "a.txt");
  assert.deepEqual(ok.lines, [{ line: 1, text: "hello" }]);
  await assert.rejects(readFile(new Sandbox(dir), "../outside.txt"), /outside the project root/);
  await assert.rejects(readFile(new Sandbox(dir), ".env"), /restricted by the sandbox/);
});

// ============================================================================
// Bug reproduction tests for peek mode with offset/limit
// These tests reproduce the issue where offset and limit are ignored when
// using read with peek=true on supported file extensions
// ============================================================================

test("read with peek=true and offset/limit on supported extension ignores offset/limit", async (t) => {
  // This test reproduces the bug reported by the user:
  // read api/server.py (peek, offset 206, limit 25)
  // The offset and limit parameters are ignored when peek=true is used with a supported extension
  
  // Create a Python file with 300 lines (Python is in PEEK_EXTENSIONS)
  const lines = Array.from({ length: 300 }, (_, i) => `def func${i + 1}(): pass`);
  const dir = await makeFixture({ "api.py": lines.join("\n") });
  t.after(() => cleanupFixture(dir));

  // Import the necessary functions to simulate the tool execution
  const { peekFile, renderPeekResult } = await import("../src/tools/peek.ts");
  const { PEEK_EXTENSIONS } = await import("../src/tools/previewManagers/registry.ts");
  
  // Simulate what happens in the read tool's execute function when peek=true
  const testPath = "api.py";
  const extension = ".py";
  const params = { path: testPath, peek: true, offset: 200, limit: 10 };
  
  // Check if peek would be used
  const usePeek = PEEK_EXTENSIONS.has(extension) && params.peek !== undefined && params.peek;
  assert.equal(usePeek, true, "peek should be used for .py files with peek=true");
  
  // This is what the execute function currently does when usePeek is true:
  // It calls peekFile WITHOUT passing params.offset and params.limit
  const result = await peekFile(new Sandbox(dir), params.path, {
    visibility: "public",
    includeDocs: false,
    maxDepth: 6,
    signal: undefined,
  });
  
  const output = renderPeekResult(params.path, result, "public");
  
  // The bug: even though we requested offset=200, limit=10,
  // the peekFile result contains ALL outline entries, not filtered to lines 200-210
  // For a Python file with 300 simple functions, peek will return all 300 function definitions
  // The output will start from line 1, not line 200
  
  // Verify the bug: output starts at line 1, not at the requested offset of 200
  const firstLineMatch = output.match(/^(\d+):/m);
  assert.ok(firstLineMatch, "Output should have line numbers");
  
  const firstLineNumber = parseInt(firstLineMatch[1]!);
  assert.equal(firstLineNumber, 1, "BUG: Output starts at line 1, ignoring the offset=200 parameter");
  
  // The total number of lines in the output should be 300 (all functions), not 10 (the requested limit)
  const lineCount = (output.match(/\n/g) || []).length + 1;
  assert.equal(lineCount, 300, "BUG: Output contains all 300 lines, ignoring the limit=10 parameter");
});

test("readFile with offset/limit works correctly without peek mode", async (t) => {
  // This test verifies that offset and limit DO work when not using peek mode
  // This is the expected behavior that users want even when using peek=true
  
  const lines = Array.from({ length: 300 }, (_, i) => `line${i + 1}`);
  const dir = await makeFixture({ "api.py": lines.join("\n") });
  t.after(() => cleanupFixture(dir));

  // readFile with offset and limit works correctly
  const result = await readFile(new Sandbox(dir), path.join(dir, "api.py"), { offset: 200, limit: 10 });
  assert.equal(result.lines.length, 10);
  assert.equal(result.lines[0]!.line, 200);
  assert.equal(result.lines[0]!.text, "line200");
  assert.equal(result.lines[9]!.line, 209);
  assert.equal(result.lines[9]!.text, "line209");
});
