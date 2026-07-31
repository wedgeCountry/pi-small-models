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

  const entries = await listDir(dir);
  assert.deepEqual(
    entries.map((e) => e.path).sort(),
    ["a.txt", "sub"]
  );
});

test("lists recursively up to maxDepth", async (t) => {
  const dir = await makeFixture({
    "a/b/c/d.txt": "",
  });
  t.after(() => cleanupFixture(dir));

  const shallow = await listDir(dir, { recursive: true, maxDepth: 1 });
  assert.deepEqual(
    shallow.map((e) => e.path).sort(),
    ["a", "a/b"]
  );

  const deep = await listDir(dir, { recursive: true, maxDepth: 5 });
  assert.ok(deep.some((e) => e.path === "a/b/c/d.txt"));
});

test("hides dotfiles by default and shows them with showHidden", async (t) => {
  const dir = await makeFixture({
    "visible.txt": "",
    ".hidden": "",
  });
  t.after(() => cleanupFixture(dir));

  const withoutHidden = await listDir(dir);
  assert.deepEqual(withoutHidden.map((e) => e.path), ["visible.txt"]);

  const withHidden = await listDir(dir, { showHidden: true });
  assert.deepEqual(withHidden.map((e) => e.path).sort(), [".hidden", "visible.txt"]);
});

test("skips default-ignored directories like node_modules", async (t) => {
  const dir = await makeFixture({
    "src/index.ts": "",
    "node_modules/dep/index.ts": "",
  });
  t.after(() => cleanupFixture(dir));

  const entries = await listDir(dir, { recursive: true, maxDepth: 5 });
  assert.ok(!entries.some((e) => e.path.includes("node_modules")));
});
