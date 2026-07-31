import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { lstatPath } from "../src/tools/lstat.ts";
import { makeFixture, cleanupFixture } from "./fixtures.ts";

test("reports metadata for a file", async (t) => {
  const dir = await makeFixture({ "a.txt": "hello" });
  t.after(() => cleanupFixture(dir));

  const result = await lstatPath(path.join(dir, "a.txt"));
  assert.equal(result.isFile, true);
  assert.equal(result.isDirectory, false);
  assert.equal(result.isSymbolicLink, false);
  assert.equal(result.size, 5);
});

test("reports metadata for a directory", async (t) => {
  const dir = await makeFixture({ "sub/a.txt": "" });
  t.after(() => cleanupFixture(dir));

  const result = await lstatPath(path.join(dir, "sub"));
  assert.equal(result.isDirectory, true);
  assert.equal(result.isFile, false);
});

test("rejects when the path does not exist", async (t) => {
  const dir = await makeFixture({});
  t.after(() => cleanupFixture(dir));

  await assert.rejects(() => lstatPath(path.join(dir, "missing.txt")));
});
