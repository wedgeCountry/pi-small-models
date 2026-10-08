import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { grepFiles } from "../src/tools/grep.ts";
import { DEFAULT_IGNORE_GLOBS } from "../src/ignore.ts";
import { makeFixture, cleanupFixture } from "./fixtures.ts";
import { Sandbox } from "../src/sandbox/sandbox.ts";

test("finds matching lines by regex", async (t) => {
  const dir = await makeFixture({
    "a.ts": "const foo = 1;\nconst bar = 2;\n",
    "b.ts": "export function foo() {}\n",
  });
  t.after(() => cleanupFixture(dir));

  const result = await grepFiles(new Sandbox(dir), ".", "foo");
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

  const result = await grepFiles(new Sandbox(dir), ".", "needle", { glob: "**/*.ts" });
  assert.equal(result.matchCount, 1);
  assert.equal(result.lines[0]?.file, "a.ts");
});

test("is case-insensitive when ignoreCase is set", async (t) => {
  const dir = await makeFixture({ "a.txt": "Hello World" });
  t.after(() => cleanupFixture(dir));

  const noCase = await grepFiles(new Sandbox(dir), ".", "hello world");
  assert.equal(noCase.matchCount, 0);

  const withCase = await grepFiles(new Sandbox(dir), ".", "hello world", { ignoreCase: true });
  assert.equal(withCase.matchCount, 1);
});

test("includes context lines around a match", async (t) => {
  const dir = await makeFixture({ "a.txt": "line1\nline2\nMATCH\nline4\nline5\n" });
  t.after(() => cleanupFixture(dir));

  const result = await grepFiles(new Sandbox(dir), ".", "MATCH", { contextLines: 1 });
  assert.deepEqual(
    result.lines.map((l) => l.text),
    ["line2", "MATCH", "line4"]
  );
});

test("truncates at maxResults", async (t) => {
  const dir = await makeFixture({ "a.txt": "x\nx\nx\nx\n" });
  t.after(() => cleanupFixture(dir));

  const result = await grepFiles(new Sandbox(dir), ".", "x", { maxResults: 2 });
  assert.equal(result.matchCount, 2);
  assert.equal(result.truncated, true);
});

test("does not report truncated when matchCount exactly equals maxResults", async (t) => {
  const dir = await makeFixture({ "a.txt": "x\nx\nx\n" });
  t.after(() => cleanupFixture(dir));

  const result = await grepFiles(new Sandbox(dir), ".", "x", { maxResults: 3 });
  assert.equal(result.matchCount, 3);
  assert.equal(result.truncated, false);
});

test("honors custom ignoreGlobs (e.g. from /ignore) on top of the hardcoded defaults", async (t) => {
  const dir = await makeFixture({
    "src/a.ts": "needle",
    "temp/b.ts": "needle",
  });
  t.after(() => cleanupFixture(dir));

  const result = await grepFiles(new Sandbox(dir), ".", "needle", {
    ignoreGlobs: [...DEFAULT_IGNORE_GLOBS, "**/temp/**"],
  });
  assert.equal(result.matchCount, 1);
  assert.equal(result.lines[0]?.file, "src/a.ts");
});

test("rejects a path that names a file instead of a directory", async (t) => {
  const dir = await makeFixture({ "main.py": "print((1))\n" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(
    () => grepFiles(new Sandbox(dir), path.join(dir, "main.py"), "\\)\\)"),
    /is a file, not a directory/
  );
});

test("rejects a path that does not exist", async (t) => {
  const dir = await makeFixture({});
  t.after(() => cleanupFixture(dir));

  await assert.rejects(() => grepFiles(new Sandbox(dir), path.join(dir, "nope"), "x"), /does not exist/);
});

test("rejects an invalid regex", async (t) => {
  const dir = await makeFixture({ "a.txt": "x" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(() => grepFiles(new Sandbox(dir), ".", "("));
});

test("aborts instead of hanging on a catastrophically backtracking pattern", async (t) => {
  const dir = await makeFixture({ "a.txt": "a".repeat(40) + "!" });
  t.after(() => cleanupFixture(dir));

  // Use a promise with race condition to ensure the test doesn't hang forever
  const timeoutPromise = new Promise((_, reject) => 
    setTimeout(() => reject(new Error("Test timed out after 5s")), 5000)
  );
  
  const grepPromise = grepFiles(new Sandbox(dir), ".", "(a+)+$", { timeoutMs: 300 })
    .then(() => { assert.fail("Expected grep to reject due to timeout"); })
    .catch((err) => {
      assert.ok(/took longer than|catastrophic|backtracking/i.test(err.message), 
        `Expected timeout error, got: ${err.message}`);
    });

  await Promise.race([grepPromise, timeoutPromise]);
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

  const result = await grepFiles(new Sandbox(dir), ".", "needle");
  assert.equal(result.matchCount, 1);
  assert.equal(result.lines.filter((l) => l.isMatch)[0]?.file, "real.txt");
});

test("excludes a sandbox-restricted file even when explicitly globbed for", async (t) => {
  // fast-glob's default dot:false already hides ".env" from a wildcard "**/*" scan, so glob for it
  // explicitly (a literal path segment, unaffected by dot:false) to exercise the sandbox's own
  // restricted-glob filter specifically, not just the upstream dotfile suppression.
  const dir = await makeFixture({ ".env": "SECRET=needle", "a.txt": "needle" });
  t.after(() => cleanupFixture(dir));

  const result = await grepFiles(new Sandbox(dir), ".", "needle", { glob: ".env" });
  assert.equal(result.matchCount, 0);
  assert.equal(result.filesScanned, 0);
});

test("an unenforced sandbox lets the worker read what an enforced one hides", async (t) => {
  // The worker holds no rules of its own: what it reads is decided by the sandbox on the main thread.
  const dir = await makeFixture({ ".env": "SECRET=needle" });
  t.after(() => cleanupFixture(dir));

  const restricted = await grepFiles(new Sandbox(dir), ".", "needle", { glob: ".env" });
  assert.equal(restricted.matchCount, 0);

  const unlocked = await grepFiles(new Sandbox(dir, false), ".", "needle", { glob: ".env" });
  assert.equal(unlocked.matchCount, 1);
});
