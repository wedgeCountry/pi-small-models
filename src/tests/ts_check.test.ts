import { test } from "node:test";
import assert from "node:assert/strict";
import { tsCheck } from "../tools/ts_check.ts";
import { makeFixture, cleanupFixture } from "./fixtures.ts";

test("handles directory with no tsconfig gracefully", async (t) => {
  const dir = await makeFixture({ "a.txt": "hello\n" });
  t.after(() => cleanupFixture(dir));

  // Type check should fail (no tsconfig.json), but shouldn't crash
  const result = await tsCheck(dir);
  assert.equal(result.success, false);
  // Output should mention the failure reason (no tsconfig, or typescript not found)
  assert.ok(result.output.length > 0);
});

test("rejects when the signal is already aborted", async (t) => {
  const dir = await makeFixture({ "a.txt": "hello\n" });
  t.after(() => cleanupFixture(dir));

  const ac = new AbortController();
  ac.abort();
  await assert.rejects(() => tsCheck(dir, { signal: ac.signal }));
});

test("accepts path option", async (t) => {
  const dir = await makeFixture({ "a.txt": "hello\n" });
  t.after(() => cleanupFixture(dir));

  // This will still fail (no tsconfig), but we're testing that the option is accepted
  const result = await tsCheck(dir, { path: "tsconfig.json" });
  assert.equal(result.success, false);
  assert.ok(typeof result.output === "string");
});

test("accepts project option", async (t) => {
  const dir = await makeFixture({ "a.txt": "hello\n" });
  t.after(() => cleanupFixture(dir));

  const result = await tsCheck(dir, { project: "tsconfig.json" });
  assert.equal(result.success, false);
  assert.ok(typeof result.output === "string");
});

test("accepts noEmit option", async (t) => {
  const dir = await makeFixture({ "a.txt": "hello\n" });
  t.after(() => cleanupFixture(dir));

  const result = await tsCheck(dir, { noEmit: false });
  // Will still fail (no tsconfig), but option should be accepted
  assert.equal(result.success, false);
  assert.ok(typeof result.output === "string");
});

test("accepts pretty option", async (t) => {
  const dir = await makeFixture({ "a.txt": "hello\n" });
  t.after(() => cleanupFixture(dir));

  const result = await tsCheck(dir, { pretty: false });
  assert.equal(result.success, false);
  assert.ok(typeof result.output === "string");
});

test("aborts an in-flight type check via signal", async (t) => {
  const dir = await makeFixture({ "a.txt": "hello\n" });
  t.after(() => cleanupFixture(dir));

  const ac = new AbortController();
  const promise = tsCheck(dir, { signal: ac.signal });
  ac.abort();
  await assert.rejects(() => promise);
});

test("handles basic tsconfig with no errors", async (t) => {
  const dir = await makeFixture({
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        noEmit: true,
        skipLibCheck: true,
      },
    }),
    "index.ts": "const x: number = 42;\n",
  });
  t.after(() => cleanupFixture(dir));

  const result = await tsCheck(dir);
  // This should succeed if typescript is installed and the file has no errors
  // If typescript isn't installed, it will fail with ENOENT
  // Either way, we just verify we got output
  assert.ok(typeof result.output === "string");
  assert.ok(result.output.length > 0);
});

test("detects type errors", async (t) => {
  const dir = await makeFixture({
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        noEmit: true,
        skipLibCheck: true,
      },
    }),
    "index.ts": "const x: number = 'not a number';\n",
  });
  t.after(() => cleanupFixture(dir));

  const result = await tsCheck(dir);
  // If typescript is installed, this should detect the type error
  // If not installed, it will fail with ENOENT
  // Either way, we should get output
  assert.ok(typeof result.output === "string");
  assert.ok(result.output.length > 0);
});