import { test } from "node:test";
import assert from "node:assert/strict";
import { dotnetBuild } from "../tools/dotnet_build.ts";
import { makeFixture, cleanupFixture } from "./fixtures.ts";

test("returns failure when dotnet is not installed", async (t) => {
  const dir = await makeFixture({ "a.txt": "hello\n" });
  t.after(() => cleanupFixture(dir));

  const result = await dotnetBuild(dir);
  assert.equal(result.success, false);
  assert.equal(result.exitCode, -1);
  assert.ok(result.output.includes("not installed or not on PATH"));
});

test("rejects when the signal is already aborted", async (t) => {
  const dir = await makeFixture({ "a.txt": "hello\n" });
  t.after(() => cleanupFixture(dir));

  const ac = new AbortController();
  ac.abort();
  await assert.rejects(() => dotnetBuild(dir, { signal: ac.signal }));
});

test("accepts configuration option", async (t) => {
  const dir = await makeFixture({ "a.txt": "hello\n" });
  t.after(() => cleanupFixture(dir));

  // This will still fail (no dotnet project), but we're testing that the option is accepted
  const result = await dotnetBuild(dir, { configuration: "Release" });
  assert.equal(result.success, false);
  // Should mention dotnet not found or build failure, not crash
  assert.ok(typeof result.output === "string");
});

test("accepts path option", async (t) => {
  const dir = await makeFixture({ "a.txt": "hello\n" });
  t.after(() => cleanupFixture(dir));

  // This will still fail (no dotnet project), but we're testing that the option is accepted
  const result = await dotnetBuild(dir, { path: "MyProject.csproj" });
  assert.equal(result.success, false);
  // Should mention dotnet not found or build failure, not crash
  assert.ok(typeof result.output === "string");
});