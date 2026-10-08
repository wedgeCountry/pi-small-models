/**
 * Pentest — Low-severity / hardening findings.
 *
 *  L3 (testable): error messages echo absolute host filesystem paths, leaking directory layout to
 *      the model and into logs. They should use the root-relative path the model supplied.
 *  L1, L4, L6 are recorded as documented skips below: they need either a symlink-creating tool
 *      (not present today), two concurrent Pi sessions, or a multi-megabyte fixture, so they are
 *      left as explicit placeholders for the reviewer rather than brittle assertions.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Sandbox } from "../../src/sandbox/sandbox.ts";
import { readFile } from "../../src/tools/read.ts";
import { makeFixture, cleanupFixture } from "../fixtures.ts";

test("L3: a read error must not echo the absolute host path", async () => {
  const root = await makeFixture({ "a.txt": "x\n" });
  try {
    const sb = new Sandbox(root); // sandbox ON
    let message = "";
    try {
      await readFile(sb, "does-not-exist.txt");
    } catch (err) {
      message = (err as Error).message;
    }
    assert.equal(
      message.includes(root),
      false,
      `INFO-LEAK: the error echoed the absolute host path: ${message}`
    );
  } finally {
    await cleanupFixture(root);
  }
});

test("L1: TOCTOU — realpath check and open are separate steps (needs a symlink-creating tool)", (t) => {
  t.skip(
    "Safe only while no tool creates symlinks with a chosen target. Re-enable with an O_NOFOLLOW " +
      "open + post-open realpath check once a symlink/extract tool exists."
  );
});

test("L4: sandbox on/off state is a process-global shared by all sessions", (t) => {
  t.skip(
    "Needs two concurrent Pi sessions in one process to demonstrate; state should be keyed by " +
      "session id rather than a module-level variable."
  );
});

test("L6: grep/find_usages read whole files with no size limit", (t) => {
  t.skip(
    "Needs a multi-megabyte fixture; files over a size cap (e.g. 2 MB) should be skipped or " +
      "streamed rather than fully buffered."
  );
});
