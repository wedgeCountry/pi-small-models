import { test } from "node:test";
import assert from "node:assert/strict";
import { findFiles } from "../src/find.ts";
import { makeFixture, cleanupFixture } from "./fixtures.ts";

test("finds files matching a glob pattern", async (t) => {
  const dir = await makeFixture({
    "src/index.ts": "",
    "src/util.ts": "",
    "src/util.test.ts": "",
    "README.md": "",
    "node_modules/dep/index.ts": "",
  });
  t.after(() => cleanupFixture(dir));

  const result = await findFiles(dir, "**/*.ts");
  assert.deepEqual(result.matches.sort(), ["src/index.ts", "src/util.test.ts", "src/util.ts"]);
  assert.equal(result.total, 3);
  assert.equal(result.truncated, false);
});

test("ignores node_modules and other default-ignored directories", async (t) => {
  const dir = await makeFixture({
    "src/index.ts": "",
    "node_modules/dep/index.ts": "",
    ".git/HEAD": "",
  });
  t.after(() => cleanupFixture(dir));

  const result = await findFiles(dir, "**/*");
  assert.ok(!result.matches.some((m) => m.includes("node_modules")));
  assert.ok(!result.matches.some((m) => m.includes(".git")));
});

test("truncates results at maxResults", async (t) => {
  const dir = await makeFixture({
    "a.txt": "",
    "b.txt": "",
    "c.txt": "",
  });
  t.after(() => cleanupFixture(dir));

  const result = await findFiles(dir, "*.txt", { maxResults: 2 });
  assert.equal(result.matches.length, 2);
  assert.equal(result.total, 3);
  assert.equal(result.truncated, true);
});
