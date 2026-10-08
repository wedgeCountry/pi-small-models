/**
 * Pentest — Finding L2 (Low) and M5 (Medium, platform).
 *
 *  L2: `npm_list` passes `package` as a bare argument, so a value starting with "-" is read by npm
 *      as an option rather than a package name (argument injection).
 *  M5: On Windows, `npm_list` / `ts_check` spawn `npm` / `npx` with `execFile` and no shell. Since
 *      Node 18.20.2 / 20.12.2 (CVE-2024-27980) that is refused with EINVAL for `.cmd` shims, so the
 *      tools cannot start at all — on the very platform the README highlights.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { Sandbox } from "../../src/sandbox/sandbox.ts";
import { npmList } from "../../src/tools/npm_list.ts";
import { makeFixture, cleanupFixture } from "../fixtures.ts";

test("L2: npm_list must not let a `-`-prefixed package become an npm option", async (t) => {
  let hasNpm = true;
  try {
    execFileSync("npm", ["--version"], { stdio: "ignore" });
  } catch {
    hasNpm = false;
  }
  if (!hasNpm) {
    t.skip("npm unavailable");
    return;
  }
  const root = await makeFixture({ "package.json": '{"name":"x","version":"1.0.0"}' });
  try {
    const sb = new Sandbox(root); // sandbox ON
    await assert.rejects(
      () => npmList(sb, { package: "--version" }),
      "SECURITY: npm_list passed a `-`-prefixed package straight to npm as an option"
    );
  } finally {
    await cleanupFixture(root);
  }
});

test("M5: on Windows, npm_list must actually start (execFile of a .cmd shim is refused)", async (t) => {
  if (process.platform !== "win32") {
    t.skip("Windows-only: execFile of npm/npx .cmd shims fails with EINVAL since CVE-2024-27980");
    return;
  }
  const root = await makeFixture({ "package.json": '{"name":"x","version":"1.0.0"}' });
  try {
    const sb = new Sandbox(root);
    const result = await npmList(sb, {});
    assert.equal(
      /EINVAL/i.test(result.output),
      false,
      "SECURITY/UX: npm_list cannot spawn npm on Windows (EINVAL), so the tool is unusable there"
    );
  } finally {
    await cleanupFixture(root);
  }
});
