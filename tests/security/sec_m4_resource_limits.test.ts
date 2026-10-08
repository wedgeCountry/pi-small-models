/**
 * Pentest — Finding M4 (Medium): unbounded work and missing subprocess timeouts.
 *
 * (a) `find`/`grep` accept absolute and `..` glob patterns. Results are filtered afterwards, but
 *     fast-glob first walks the named tree (e.g. the whole filesystem from "/"), which is a cheap
 *     denial-of-service and a surprising traversal. A safe tool rejects such patterns up front.
 * (b) `runCommand` (and `dotnetBuild`) set no timeout, so a hung or deliberately slow child holds
 *     the tool indefinitely.
 *
 * Secure expectations below FAIL today. (b) is timing-based and POSIX-only (uses `sleep`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Sandbox } from "../../src/sandbox/sandbox.ts";
import { findFiles } from "../../src/tools/find.ts";
import { listDir } from "../../src/tools/list.ts";
import { runCommand } from "../../src/runCommand.ts";
import { makeFixture, cleanupFixture } from "../fixtures.ts";

test("M4a: find must reject an absolute glob pattern instead of walking from it", async () => {
  const root = await makeFixture({ "a.txt": "x\n" });
  try {
    const sb = new Sandbox(root); // sandbox ON
    await assert.rejects(
      () => findFiles(sb, ".", "/etc/**"),
      "SECURITY/DoS: find accepted an absolute glob and walked outside the project tree"
    );
  } finally {
    await cleanupFixture(root);
  }
});

test("M4a: list must clamp recursion depth instead of honouring an arbitrary maxDepth", async () => {
  // Build a deep chain a/a/a/… so an unclamped recursive walk descends the whole way.
  const files: Record<string, string> = {};
  const deep = Array.from({ length: 30 }, () => "a").join("/");
  files[`${deep}/leaf.txt`] = "x\n";
  const root = await makeFixture(files);
  try {
    const sb = new Sandbox(root); // sandbox ON
    const result = await listDir(sb, ".", { recursive: true, maxDepth: 1000 });
    const deepest = Math.max(0, ...result.entries.map((e) => e.path.split("/").length));
    assert.ok(
      deepest <= 16,
      `DoS: list honoured maxDepth=1000 and walked ${deepest} levels deep; depth should be clamped`
    );
  } finally {
    await cleanupFixture(root);
  }
});

test("M4b: a slow child process must be bounded by a timeout", async (t) => {
  if (process.platform === "win32") {
    t.skip("POSIX `sleep` scenario");
    return;
  }
  const started = Date.now();
  // A safe runCommand enforces a default wall-clock budget; 2 s of sleep should be cut short.
  let rejected = false;
  try {
    await runCommand("sleep", ["2"], { cwd: process.cwd() });
  } catch {
    rejected = true;
  }
  const elapsed = Date.now() - started;
  assert.ok(
    rejected && elapsed < 1800,
    `SECURITY/DoS: runCommand ran the full sleep (${elapsed} ms) with no timeout`
  );
});
