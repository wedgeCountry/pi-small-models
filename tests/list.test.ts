import { test } from "node:test";
import assert from "node:assert/strict";
import { listDir } from "../src/tools/list.ts";
import { makeFixture, cleanupFixture } from "./fixtures.ts";

test("lists top-level entries non-recursively", async (t) => {
  const dir = await makeFixture({
    "a.txt": "",
    "sub/b.txt": "",
  });
  t.after(() => cleanupFixture(dir));

  const result = await listDir(dir);
  assert.deepEqual(
    result.entries.map((e) => e.path).sort(),
    ["a.txt", "sub"]
  );
  assert.equal(result.truncated, false);
});

test("lists recursively up to maxDepth", async (t) => {
  const dir = await makeFixture({
    "a/b/c/d.txt": "",
  });
  t.after(() => cleanupFixture(dir));

  const shallow = await listDir(dir, { recursive: true, maxDepth: 1 });
  assert.deepEqual(
    shallow.entries.map((e) => e.path).sort(),
    ["a", "a/b"]
  );

  const deep = await listDir(dir, { recursive: true, maxDepth: 5 });
  assert.ok(deep.entries.some((e) => e.path === "a/b/c/d.txt"));
});

test("hides dotfiles by default and shows them with showHidden", async (t) => {
  const dir = await makeFixture({
    "visible.txt": "",
    ".hidden": "",
  });
  t.after(() => cleanupFixture(dir));

  const withoutHidden = await listDir(dir);
  assert.deepEqual(withoutHidden.entries.map((e) => e.path), ["visible.txt"]);

  const withHidden = await listDir(dir, { showHidden: true });
  assert.deepEqual(withHidden.entries.map((e) => e.path).sort(), [".hidden", "visible.txt"]);
});

test("skips default-ignored directories like node_modules", async (t) => {
  const dir = await makeFixture({
    "src/index.ts": "",
    "node_modules/dep/index.ts": "",
  });
  t.after(() => cleanupFixture(dir));

  const result = await listDir(dir, { recursive: true, maxDepth: 5 });
  assert.ok(!result.entries.some((e) => e.path.includes("node_modules")));
});

test("truncates at maxResults", async (t) => {
  const dir = await makeFixture({
    "a.txt": "",
    "b.txt": "",
    "c.txt": "",
    "d.txt": "",
  });
  t.after(() => cleanupFixture(dir));

  const result = await listDir(dir, { maxResults: 2 });
  assert.equal(result.entries.length, 2);
  assert.equal(result.total, 4);
  assert.equal(result.truncated, true);
});

test("does not report truncated when entry count exactly equals maxResults", async (t) => {
  const dir = await makeFixture({
    "a.txt": "",
    "b.txt": "",
  });
  t.after(() => cleanupFixture(dir));

  const result = await listDir(dir, { maxResults: 2 });
  assert.equal(result.entries.length, 2);
  assert.equal(result.truncated, false);
});
