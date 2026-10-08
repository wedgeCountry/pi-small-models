/**
 * Pentest — Finding M6 (Medium): output caps don't hold for a single long line.
 *
 * `readFile` (and `gitDiff`) trim whole lines until under the 50 KB byte cap, but stop at one
 * line, so a file consisting of one very long line is returned in full — a minified bundle or a
 * data file can flood a small model's context and blow past provider token limits.
 *
 * Secure expectation: the byte cap holds regardless of line structure. FAILS today (the whole
 * line comes back).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Sandbox } from "../../src/sandbox/sandbox.ts";
import { readFile } from "../../src/tools/read.ts";
import { makeFixture, cleanupFixture } from "../fixtures.ts";

const DEFAULT_MAX_BYTES = 50 * 1024;

test("M6: read must cap a single very long line at roughly the byte limit", async () => {
  const oneLongLine = "x".repeat(5 * 1024 * 1024); // 5 MB, no newlines
  const root = await makeFixture({ "bundle.min.js": oneLongLine });
  try {
    const sb = new Sandbox(root); // sandbox ON
    const result = await readFile(sb, "bundle.min.js");
    const bytes = Buffer.byteLength(result.lines.map((l) => l.text).join("\n"), "utf8");

    // Allow generous headroom over the cap; today the full 5 MB is returned.
    assert.ok(
      bytes <= DEFAULT_MAX_BYTES * 2,
      `SECURITY/DoS: read returned ${bytes} bytes for a single-line file; the ~${DEFAULT_MAX_BYTES}-byte cap did not hold`
    );
    assert.equal(result.truncated, true, "read should mark a capped single-line file as truncated");
  } finally {
    await cleanupFixture(root);
  }
});
