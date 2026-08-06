import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { insertText } from "../src/tools/insert.ts";
import { makeFixture, cleanupFixture } from "./fixtures.ts";

test("inserts text after the given line", async (t) => {
  const dir = await makeFixture({ "a.txt": "line1\nline2\nline3" });
  t.after(() => cleanupFixture(dir));

  await insertText(path.join(dir, "a.txt"), 1, "inserted");
  const content = await fs.readFile(path.join(dir, "a.txt"), "utf8");
  assert.equal(content, "line1\ninserted\nline2\nline3");
});

test("inserts before the first line when line is 0", async (t) => {
  const dir = await makeFixture({ "a.txt": "line1\nline2" });
  t.after(() => cleanupFixture(dir));

  await insertText(path.join(dir, "a.txt"), 0, "inserted");
  const content = await fs.readFile(path.join(dir, "a.txt"), "utf8");
  assert.equal(content, "inserted\nline1\nline2");
});

test("appends at the end when line equals the line count", async (t) => {
  const dir = await makeFixture({ "a.txt": "line1\nline2" });
  t.after(() => cleanupFixture(dir));

  await insertText(path.join(dir, "a.txt"), 2, "inserted");
  const content = await fs.readFile(path.join(dir, "a.txt"), "utf8");
  assert.equal(content, "line1\nline2\ninserted");
});

test("splits multi-line text across multiple inserted lines", async (t) => {
  const dir = await makeFixture({ "a.txt": "line1\nline2" });
  t.after(() => cleanupFixture(dir));

  await insertText(path.join(dir, "a.txt"), 1, "foo\nbar");
  const content = await fs.readFile(path.join(dir, "a.txt"), "utf8");
  assert.equal(content, "line1\nfoo\nbar\nline2");
});

test("preserves CRLF line endings instead of mixing them with bare LF", async (t) => {
  const dir = await makeFixture({ "a.txt": "line1\r\nline2\r\nline3" });
  t.after(() => cleanupFixture(dir));

  await insertText(path.join(dir, "a.txt"), 1, "inserted");
  const content = await fs.readFile(path.join(dir, "a.txt"), "utf8");
  assert.equal(content, "line1\r\ninserted\r\nline2\r\nline3");
});

test("rejects a negative line number", async (t) => {
  const dir = await makeFixture({ "a.txt": "line1" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(() => insertText(path.join(dir, "a.txt"), -1, "x"));
});

test("rejects a line number past the end of the file", async (t) => {
  const dir = await makeFixture({ "a.txt": "line1\nline2" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(() => insertText(path.join(dir, "a.txt"), 3, "x"));
});

test("rejects when the file does not exist", async (t) => {
  const dir = await makeFixture({});
  t.after(() => cleanupFixture(dir));

  await assert.rejects(() => insertText(path.join(dir, "missing.txt"), 0, "x"));
});

test("rejects when the signal is already aborted, without modifying the file", async (t) => {
  const dir = await makeFixture({ "a.txt": "line1\nline2" });
  t.after(() => cleanupFixture(dir));

  const ac = new AbortController();
  ac.abort();
  await assert.rejects(() => insertText(path.join(dir, "a.txt"), 1, "inserted", { signal: ac.signal }));
  const content = await fs.readFile(path.join(dir, "a.txt"), "utf8");
  assert.equal(content, "line1\nline2");
});

test("serializes concurrent inserts so none of them are lost", async (t) => {
  const dir = await makeFixture({ "a.txt": "base" });
  t.after(() => cleanupFixture(dir));
  const file = path.join(dir, "a.txt");

  // Without serialization, all three calls would read the original "base" before any of them
  // writes, and only the last write to land would survive.
  await Promise.all([insertText(file, 0, "one"), insertText(file, 0, "two"), insertText(file, 0, "three")]);

  const content = await fs.readFile(file, "utf8");
  const lines = content.split("\n");
  assert.equal(lines.length, 4);
  assert.deepEqual(new Set(lines), new Set(["one", "two", "three", "base"]));
});
