import { test } from "node:test";
import assert from "node:assert/strict";
import { dotnetBuild } from "../tools/dotnet_build.ts";
import { makeFixture, cleanupFixture } from "./fixtures.ts";

test("handles missing dotnet project gracefully", async (t) => {
  const dir = await makeFixture({ "a.txt": "hello\n" });
  t.after(() => cleanupFixture(dir));

  const result = await dotnetBuild(dir);
  // Build should fail (no .csproj/.sln in fixture), but shouldn't crash
  assert.equal(result.success, false);
  // Output should mention the failure reason (no project, or dotnet not found)
  assert.ok(result.output.length > 0);
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