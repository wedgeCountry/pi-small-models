import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { findFiles } from "../src/tools/find.ts";
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

test("omits a symlink that points outside the base directory", async (t) => {
  const dir = await makeFixture({ "real.txt": "" });
  const outside = await makeFixture({ "secret.txt": "top secret" });
  t.after(() => Promise.all([cleanupFixture(dir), cleanupFixture(outside)]));

  const link = path.join(dir, "link.txt");
  try {
    await fs.symlink(path.join(outside, "secret.txt"), link, "file");
  } catch (err) {
    t.skip(`cannot create symlinks in this environment: ${(err as Error).message}`);
    return;
  }

  const result = await findFiles(dir, "**/*");
  assert.deepEqual(result.matches, ["real.txt"]);
});
