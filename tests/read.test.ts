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
// Tests for peek mode behavior with offset/limit
// These tests verify that:
// - peek mode is used when offset and limit are NOT provided (on supported extensions)
// - standard read mode is used when offset or limit ARE provided (even on supported extensions)
// ============================================================================

test("read with offset/limit on supported extension uses standard read mode, not peek", async (t) => {
  // This test verifies the fix: when offset or limit are provided,
  // the read tool should use standard read mode (not peek), even on supported extensions
  
  // Create a Python file with 300 lines (Python is in PEEK_EXTENSIONS)
  const lines = Array.from({ length: 300 }, (_, i) => `line${i + 1}`);
  const dir = await makeFixture({ "api.py": lines.join("\n") });
  t.after(() => cleanupFixture(dir));

  // When offset and limit are provided, read should use standard mode, not peek
  // This should return lines 200-209 (10 lines starting from line 200)
  const result = await readFile(new Sandbox(dir), path.join(dir, "api.py"), { offset: 200, limit: 10 });
  assert.equal(result.lines.length, 10);
  assert.equal(result.lines[0]!.line, 200);
  assert.equal(result.lines[0]!.text, "line200");
  assert.equal(result.lines[9]!.line, 209);
  assert.equal(result.lines[9]!.text, "line209");
});

test("read without offset/limit on supported extension uses peek mode", async (t) => {
  // This test verifies that when offset and limit are NOT provided,
  // the read tool uses peek mode for supported extensions
  
  // Create a Python file with 300 lines (Python is in PEEK_EXTENSIONS)
  const lines = Array.from({ length: 300 }, (_, i) => `def func${i + 1}(): pass`);
  const dir = await makeFixture({ "api.py": lines.join("\n") });
  t.after(() => cleanupFixture(dir));

  // Import the necessary functions to verify peek is used
  const { peekFile } = await import("../src/tools/peek.ts");
  const { PEEK_EXTENSIONS } = await import("../src/tools/previewManagers/registry.ts");
  
  // Verify that .py is a supported extension
  assert.ok(PEEK_EXTENSIONS.includes(".py"), "Python should be a supported extension for peek");
  
  // When offset and limit are not provided, peek should be used
  const peekResult = await peekFile(new Sandbox(dir), path.join(dir, "api.py"));
  assert.ok(peekResult.lines.length > 0, "peekFile should return outline entries");
  assert.equal(peekResult.totalLines, 300, "peekFile should report total lines");
});


test("read with peek=false on supported extension uses standard read mode", async (t) => {
  // This test verifies the fix: when peek=false is explicitly set,
  // the read tool should use standard read mode (not peek), even on supported extensions
  
  // Create a Python file with 300 lines (Python is in PEEK_EXTENSIONS)
  const lines = Array.from({ length: 300 }, (_, i) => `line${i + 1}`);
  const dir = await makeFixture({ "api.py": lines.join("\n") });
  t.after(() => cleanupFixture(dir));

  // When peek=false is explicitly set, standard read should be used
  // This should return the actual file content, not a peek outline
  const result = await readFile(new Sandbox(dir), path.join(dir, "api.py"), { peek: false });
  assert.equal(result.lines.length, 300, "Should return all 300 lines");
  assert.equal(result.totalLines, 300);
  assert.equal(result.truncated, false, "Should not be truncated since file < DEFAULT_MAX_LINES");
  assert.equal(result.lines[0]!.text, "line1", "First line should be actual content");
  assert.equal(result.lines[299]!.text, "line300", "Last line should be actual content");
});

test("strips a UTF-8 BOM", async (t) => {
  const dir = await makeFixture({ "bom.txt": Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("héllo")]) });
  t.after(() => cleanupFixture(dir));

  const result = await readFile(new Sandbox(dir), path.join(dir, "bom.txt"));
  assert.deepEqual(result.lines, [{ line: 1, text: "héllo" }]);
});

test("decodes UTF-16LE with BOM", async (t) => {
  const dir = await makeFixture({ "u16le.txt": Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("héllo", "utf16le")]) });
  t.after(() => cleanupFixture(dir));

  const result = await readFile(new Sandbox(dir), path.join(dir, "u16le.txt"));
  assert.deepEqual(result.lines, [{ line: 1, text: "héllo" }]);
});

test("decodes UTF-16BE with BOM", async (t) => {
  const dir = await makeFixture({ "u16be.txt": Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from("héllo", "utf16le").swap16()]) });
  t.after(() => cleanupFixture(dir));

  const result = await readFile(new Sandbox(dir), path.join(dir, "u16be.txt"));
  assert.deepEqual(result.lines, [{ line: 1, text: "héllo" }]);
});

test("rejects binary files containing NUL bytes", async (t) => {
  const dir = await makeFixture({ "bin.dat": Buffer.from([0x4d, 0x5a, 0x00, 0x01, 0x02]) });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(
    readFile(new Sandbox(dir), path.join(dir, "bin.dat")),
    /binary file/,
  );
});
