import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { editFile } from "../src/tools/edit.ts";
import { makeFixture, cleanupFixture } from "./fixtures.ts";

test("replaces a unique block of text", async (t) => {
  const dir = await makeFixture({ "a.txt": "const foo = 1;\nconst bar = 2;\n" });
  t.after(() => cleanupFixture(dir));

  await editFile(path.join(dir, "a.txt"), "const foo = 1;", "const foo = 2;");
  const content = await fs.readFile(path.join(dir, "a.txt"), "utf8");
  assert.equal(content, "const foo = 2;\nconst bar = 2;\n");
});

test("rejects when oldText is not found", async (t) => {
  const dir = await makeFixture({ "a.txt": "hello\n" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(() => editFile(path.join(dir, "a.txt"), "missing", "x"));
});

test("rejects when oldText matches more than once", async (t) => {
  const dir = await makeFixture({ "a.txt": "dup\ndup\n" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(() => editFile(path.join(dir, "a.txt"), "dup", "x"));
});

test("rejects when oldText and newText are identical", async (t) => {
  const dir = await makeFixture({ "a.txt": "same\n" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(() => editFile(path.join(dir, "a.txt"), "same", "same"));
});

test("rejects when the file does not exist", async (t) => {
  const dir = await makeFixture({});
  t.after(() => cleanupFixture(dir));

  await assert.rejects(() => editFile(path.join(dir, "missing.txt"), "a", "b"));
});

test("replaces all occurrences when allowMultipleMatches is set", async (t) => {
  const dir = await makeFixture({ "a.txt": "dup\ndup\ndup\n" });
  t.after(() => cleanupFixture(dir));

  await editFile(path.join(dir, "a.txt"), "dup", "x", { allowMultipleMatches: true });
  const content = await fs.readFile(path.join(dir, "a.txt"), "utf8");
  assert.equal(content, "x\nx\nx\n");
});

test("still rejects when oldText is not found and allowMultipleMatches is set", async (t) => {
  const dir = await makeFixture({ "a.txt": "hello\n" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(() => editFile(path.join(dir, "a.txt"), "missing", "x", { allowMultipleMatches: true }));
});

test("rejects when the signal is already aborted, without modifying the file", async (t) => {
  const dir = await makeFixture({ "a.txt": "const foo = 1;\n" });
  t.after(() => cleanupFixture(dir));

  const ac = new AbortController();
  ac.abort();
  await assert.rejects(() => editFile(path.join(dir, "a.txt"), "const foo = 1;", "const foo = 2;", { signal: ac.signal }));
  const content = await fs.readFile(path.join(dir, "a.txt"), "utf8");
  assert.equal(content, "const foo = 1;\n");
});
