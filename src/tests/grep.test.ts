import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { grepFiles } from "../tools/grep.ts";
import { setSandboxState } from "../sandbox.ts";
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

test("rejects a path that names a file instead of a directory", async (t) => {
  const dir = await makeFixture({ "main.py": "print((1))\n" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(
    () => grepFiles(path.join(dir, "main.py"), "\\)\\)"),
    /is a file, not a directory/
  );
});

test("rejects a path that does not exist", async (t) => {
  const dir = await makeFixture({});
  t.after(() => cleanupFixture(dir));

  await assert.rejects(() => grepFiles(path.join(dir, "nope"), "x"), /does not exist/);
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

test("excludes a sandbox-restricted file even when explicitly globbed for", async (t) => {
  // fast-glob's default dot:false already hides ".env" from a wildcard "**/*" scan, so glob for it
  // explicitly (a literal path segment, unaffected by dot:false) to exercise the sandbox's own
  // restricted-glob filter specifically, not just the upstream dotfile suppression.
  const dir = await makeFixture({ ".env": "SECRET=needle", "a.txt": "needle" });
  t.after(() => cleanupFixture(dir));

  const result = await grepFiles(dir, "needle", { glob: ".env" });
  assert.equal(result.matchCount, 0);
  assert.equal(result.filesScanned, 0);
});

test("propagates the current sandbox state to the worker thread end-to-end", async (t) => {
  // A regression test for the worker/main-thread state-sync itself: grepWorker.ts imports
  // sandbox.ts in its own worker_threads isolate, which starts with its own independent
  // module-level state (always "on") — if the current state weren't explicitly passed across that
  // boundary, toggling sandboxState to "off" here would unlock the file in the main thread's
  // pre-filter but the worker would still reject it against its own stale "on" default.
  const dir = await makeFixture({ ".env": "SECRET=needle" });
  t.after(async () => {
    await cleanupFixture(dir);
    setSandboxState("on");
  });

  const restricted = await grepFiles(dir, "needle", { glob: ".env" });
  assert.equal(restricted.matchCount, 0);

  setSandboxState("off");
  const unlocked = await grepFiles(dir, "needle", { glob: ".env" });
  assert.equal(unlocked.matchCount, 1);
});
