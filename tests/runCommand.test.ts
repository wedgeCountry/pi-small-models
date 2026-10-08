import { test } from "node:test";
import assert from "node:assert/strict";
import * as os from "node:os";
import { runCommand, CommandNotFoundError } from "../src/runCommand.ts";

const cwd = os.tmpdir();

test("returns stdout and exit code 0 on success", async () => {
  const r = await runCommand(process.execPath, ["-e", "process.stdout.write('hi')"], { cwd });
  assert.deepEqual(r, { stdout: "hi", stderr: "", exitCode: 0 });
});

test("returns output instead of throwing on a non-zero exit", async () => {
  const r = await runCommand(
    process.execPath,
    ["-e", "process.stdout.write('tree'); process.stderr.write('missing: x'); process.exit(3)"],
    { cwd }
  );
  assert.equal(r.exitCode, 3);
  assert.equal(r.stdout, "tree");
  assert.equal(r.stderr, "missing: x");
});

test("throws CommandNotFoundError for a missing executable", async () => {
  await assert.rejects(
    () => runCommand("definitely-not-a-real-command-xyz", [], { cwd }),
    (err: unknown) => err instanceof CommandNotFoundError
  );
});

test("rejects with AbortError when the signal is already aborted", async () => {
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(
    () => runCommand("definitely-not-a-real-command-xyz", [], { cwd, signal: ac.signal }),
    { name: "AbortError" }
  );
});

test("rejects with AbortError when aborted in flight", async () => {
  const ac = new AbortController();
  const p = runCommand(process.execPath, ["-e", "setTimeout(() => {}, 10000)"], { cwd, signal: ac.signal });
  setTimeout(() => ac.abort(), 50);
  await assert.rejects(() => p, { name: "AbortError" });
});
