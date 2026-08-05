import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { grepFiles } from "../src/tools/grep.ts";
import { makeFixture, cleanupFixture } from "./fixtures.ts";

test("finds matching lines by regex", async (t) => {
  const dir = await makeFixture({
    "a.ts": "const foo = 1;\nconst bar = 2;\n",
    "b.ts": "export function foo() {}\n",
  });
  t.after(() => cleanupFixture(dir));

  const result = await grepFiles(dir, "foo");
  assert.equal(result.matchCount, 2);
  const matchLines = result.lines.filter((l) => l.isMatch);
  assert.deepEqual(
    matchLines.map((l) => l.file).sort(),
    ["a.ts", "b.ts"]
  );
});

test("respects the glob filter", async (t) => {
  const dir = await makeFixture({
    "a.ts": "needle",
    "a.md": "needle",
  });
  t.after(() => cleanupFixture(dir));

  const result = await grepFiles(dir, "needle", { glob: "**/*.ts" });
  assert.equal(result.matchCount, 1);
  assert.equal(result.lines[0]?.file, "a.ts");
});

test("is case-insensitive when ignoreCase is set", async (t) => {
  const dir = await makeFixture({ "a.txt": "Hello World" });
  t.after(() => cleanupFixture(dir));

  const noCase = await grepFiles(dir, "hello world");
  assert.equal(noCase.matchCount, 0);

  const withCase = await grepFiles(dir, "hello world", { ignoreCase: true });
  assert.equal(withCase.matchCount, 1);
});

test("includes context lines around a match", async (t) => {
  const dir = await makeFixture({ "a.txt": "line1\nline2\nMATCH\nline4\nline5\n" });
  t.after(() => cleanupFixture(dir));

  const result = await grepFiles(dir, "MATCH", { contextLines: 1 });
  assert.deepEqual(
    result.lines.map((l) => l.text),
    ["line2", "MATCH", "line4"]
  );
});

test("truncates at maxResults", async (t) => {
  const dir = await makeFixture({ "a.txt": "x\nx\nx\nx\n" });
  t.after(() => cleanupFixture(dir));

  const result = await grepFiles(dir, "x", { maxResults: 2 });
  assert.equal(result.matchCount, 2);
  assert.equal(result.truncated, true);
});

test("does not report truncated when matchCount exactly equals maxResults", async (t) => {
  const dir = await makeFixture({ "a.txt": "x\nx\nx\n" });
  t.after(() => cleanupFixture(dir));

  const result = await grepFiles(dir, "x", { maxResults: 3 });
  assert.equal(result.matchCount, 3);
  assert.equal(result.truncated, false);
});

test("rejects an invalid regex", async (t) => {
  const dir = await makeFixture({ "a.txt": "x" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(() => grepFiles(dir, "("));
});

test("aborts instead of hanging on a catastrophically backtracking pattern", async (t) => {
  const dir = await makeFixture({ "a.txt": "a".repeat(40) + "!" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(() => grepFiles(dir, "(a+)+$", { timeoutMs: 300 }), /took longer than/);
});

test("does not read through a symlink that points outside the base directory", async (t) => {
  const dir = await makeFixture({ "real.txt": "needle" });
  const outside = await makeFixture({ "secret.txt": "needle (secret)" });
  t.after(() => Promise.all([cleanupFixture(dir), cleanupFixture(outside)]));

  const link = path.join(dir, "link.txt");
  try {
    await fs.symlink(path.join(outside, "secret.txt"), link, "file");
  } catch (err) {
    t.skip(`cannot create symlinks in this environment: ${(err as Error).message}`);
    return;
  }

  const result = await grepFiles(dir, "needle");
  assert.equal(result.matchCount, 1);
  assert.equal(result.lines.filter((l) => l.isMatch)[0]?.file, "real.txt");
});
