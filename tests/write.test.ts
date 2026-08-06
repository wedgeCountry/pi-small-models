import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { writeFile } from "../src/tools/write.ts";
import { makeFixture, cleanupFixture } from "./fixtures.ts";

test("creates a new file with the given content", async (t) => {
  const dir = await makeFixture({});
  t.after(() => cleanupFixture(dir));

  await writeFile(path.join(dir, "a.txt"), "hello\n");
  const content = await fs.readFile(path.join(dir, "a.txt"), "utf8");
  assert.equal(content, "hello\n");
});

test("overwrites an existing file", async (t) => {
  const dir = await makeFixture({ "a.txt": "old\n" });
  t.after(() => cleanupFixture(dir));

  await writeFile(path.join(dir, "a.txt"), "new\n");
  const content = await fs.readFile(path.join(dir, "a.txt"), "utf8");
  assert.equal(content, "new\n");
});

test("creates missing parent directories", async (t) => {
  const dir = await makeFixture({});
  t.after(() => cleanupFixture(dir));

  await writeFile(path.join(dir, "a", "b", "c.txt"), "hello\n");
  const content = await fs.readFile(path.join(dir, "a", "b", "c.txt"), "utf8");
  assert.equal(content, "hello\n");
});

test("rejects when the signal is already aborted, without creating the file", async (t) => {
  const dir = await makeFixture({});
  t.after(() => cleanupFixture(dir));

  const ac = new AbortController();
  ac.abort();
  await assert.rejects(() => writeFile(path.join(dir, "a.txt"), "hello\n", { signal: ac.signal }));
  await assert.rejects(() => fs.stat(path.join(dir, "a.txt")));
});
