import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { readFile } from "../tools/read.ts";
import { makeFixture, cleanupFixture } from "./fixtures.ts";

test("reads a whole file as 1-indexed lines", async (t) => {
  const dir = await makeFixture({ "a.txt": "line1\nline2\nline3" });
  t.after(() => cleanupFixture(dir));

  const result = await readFile(path.join(dir, "a.txt"));
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

  const result = await readFile(path.join(dir, "a.txt"), { offset: 2 });
  assert.deepEqual(result.lines, [
    { line: 2, text: "line2" },
    { line: 3, text: "line3" },
  ]);
  assert.equal(result.truncated, false);
});

test("honors limit and reports truncation with a continuation offset", async (t) => {
  const dir = await makeFixture({ "a.txt": "line1\nline2\nline3" });
  t.after(() => cleanupFixture(dir));

  const result = await readFile(path.join(dir, "a.txt"), { limit: 2 });
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

  const result = await readFile(path.join(dir, "a.txt"), { offset: 2, limit: 2 });
  assert.deepEqual(result.lines, [
    { line: 2, text: "line2" },
    { line: 3, text: "line3" },
  ]);
  assert.equal(result.truncated, true);
});

test("is not truncated when limit reaches exactly the end of the file", async (t) => {
  const dir = await makeFixture({ "a.txt": "line1\nline2\nline3" });
  t.after(() => cleanupFixture(dir));

  const result = await readFile(path.join(dir, "a.txt"), { limit: 3 });
  assert.equal(result.lines.length, 3);
  assert.equal(result.truncated, false);
});

test("splits lines the same way insert does, so line numbers agree across tools", async (t) => {
  const dir = await makeFixture({ "a.txt": "line1\r\nline2\r\nline3" });
  t.after(() => cleanupFixture(dir));

  const result = await readFile(path.join(dir, "a.txt"));
  assert.deepEqual(
    result.lines.map((l) => l.text),
    ["line1", "line2", "line3"]
  );
});

test("caps output at DEFAULT_MAX_LINES lines even without an explicit limit", async (t) => {
  const lines = Array.from({ length: 2005 }, (_, i) => `line${i + 1}`);
  const dir = await makeFixture({ "a.txt": lines.join("\n") });
  t.after(() => cleanupFixture(dir));

  const result = await readFile(path.join(dir, "a.txt"));
  assert.equal(result.lines.length, 2000);
  assert.equal(result.totalLines, 2005);
  assert.equal(result.truncated, true);
});

test("rejects an offset beyond the end of the file", async (t) => {
  const dir = await makeFixture({ "a.txt": "line1\nline2" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(() => readFile(path.join(dir, "a.txt"), { offset: 3 }));
});

test("rejects a non-positive offset", async (t) => {
  const dir = await makeFixture({ "a.txt": "line1" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(() => readFile(path.join(dir, "a.txt"), { offset: 0 }));
});

test("rejects a non-positive limit", async (t) => {
  const dir = await makeFixture({ "a.txt": "line1" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(() => readFile(path.join(dir, "a.txt"), { limit: 0 }));
});

test("rejects when the file does not exist", async (t) => {
  const dir = await makeFixture({});
  t.after(() => cleanupFixture(dir));

  await assert.rejects(() => readFile(path.join(dir, "missing.txt")));
});

test("rejects when the signal is already aborted", async (t) => {
  const dir = await makeFixture({ "a.txt": "line1" });
  t.after(() => cleanupFixture(dir));

  const ac = new AbortController();
  ac.abort();
  await assert.rejects(() => readFile(path.join(dir, "a.txt"), { signal: ac.signal }));
});
