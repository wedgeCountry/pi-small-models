import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { makeDir } from "../src/tools/mkdir.ts";
import { makeFixture, cleanupFixture } from "./fixtures.ts";

test("creates a directory", async (t) => {
  const dir = await makeFixture({});
  t.after(() => cleanupFixture(dir));

  await makeDir(path.join(dir, "sub"));
  const stat = await fs.stat(path.join(dir, "sub"));
  assert.ok(stat.isDirectory());
});

test("creates missing parent directories", async (t) => {
  const dir = await makeFixture({});
  t.after(() => cleanupFixture(dir));

  await makeDir(path.join(dir, "a", "b", "c"));
  const stat = await fs.stat(path.join(dir, "a", "b", "c"));
  assert.ok(stat.isDirectory());
});

test("succeeds silently when the directory already exists", async (t) => {
  const dir = await makeFixture({ "sub/keep.txt": "" });
  t.after(() => cleanupFixture(dir));

  await makeDir(path.join(dir, "sub"));
  const stat = await fs.stat(path.join(dir, "sub", "keep.txt"));
  assert.ok(stat.isFile());
});

test("rejects when the path already exists as a file", async (t) => {
  const dir = await makeFixture({ "a.txt": "" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(() => makeDir(path.join(dir, "a.txt")));
});

test("rejects when the signal is already aborted, without creating the directory", async (t) => {
  const dir = await makeFixture({});
  t.after(() => cleanupFixture(dir));

  const ac = new AbortController();
  ac.abort();
  await assert.rejects(() => makeDir(path.join(dir, "sub"), { signal: ac.signal }));
  await assert.rejects(() => fs.stat(path.join(dir, "sub")));
});
