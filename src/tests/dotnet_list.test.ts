import { test } from "node:test";
import assert from "node:assert/strict";
import { dotnetList } from "../tools/dotnet_list.ts";
import { makeFixture, cleanupFixture } from "./fixtures.ts";

test("handles missing dotnet project gracefully", async (t) => {
  const dir = await makeFixture({ "a.txt": "hello\n" });
  t.after(() => cleanupFixture(dir));

  // List should fail (no .csproj/.sln in fixture), but shouldn't crash
  const result = await dotnetList(dir);
  assert.equal(result.success, false);
  // Output should mention the failure reason (no project, or dotnet not found)
  assert.ok(result.output.length > 0);
});

test("rejects when the signal is already aborted", async (t) => {
  const dir = await makeFixture({ "a.txt": "hello\n" });
  t.after(() => cleanupFixture(dir));

  const ac = new AbortController();
  ac.abort();
  await assert.rejects(() => dotnetList(dir, { signal: ac.signal }));
});

test("accepts outdated option", async (t) => {
  const dir = await makeFixture({ "a.txt": "hello\n" });
  t.after(() => cleanupFixture(dir));

  // This will still fail (no dotnet project), but we're testing that the option is accepted
  const result = await dotnetList(dir, { outdated: true });
  assert.equal(result.success, false);
  // Should mention dotnet not found or list failure, not crash
  assert.ok(typeof result.output === "string");
});

test("accepts includeTransitive option", async (t) => {
  const dir = await makeFixture({ "a.txt": "hello\n" });
  t.after(() => cleanupFixture(dir));

  const result = await dotnetList(dir, { includeTransitive: true });
  assert.equal(result.success, false);
  assert.ok(typeof result.output === "string");
});

test("accepts includePrerelease option", async (t) => {
  const dir = await makeFixture({ "a.txt": "hello\n" });
  t.after(() => cleanupFixture(dir));

  const result = await dotnetList(dir, { includePrerelease: true });
  assert.equal(result.success, false);
  assert.ok(typeof result.output === "string");
});

test("accepts deprecated option", async (t) => {
  const dir = await makeFixture({ "a.txt": "hello\n" });
  t.after(() => cleanupFixture(dir));

  const result = await dotnetList(dir, { deprecated: true });
  assert.equal(result.success, false);
  assert.ok(typeof result.output === "string");
});

test("accepts vulnerable option", async (t) => {
  const dir = await makeFixture({ "a.txt": "hello\n" });
  t.after(() => cleanupFixture(dir));

  const result = await dotnetList(dir, { vulnerable: true });
  assert.equal(result.success, false);
  assert.ok(typeof result.output === "string");
});

test("accepts noRestore option", async (t) => {
  const dir = await makeFixture({ "a.txt": "hello\n" });
  t.after(() => cleanupFixture(dir));

  const result = await dotnetList(dir, { noRestore: true });
  assert.equal(result.success, false);
  assert.ok(typeof result.output === "string");
});

test("accepts path option", async (t) => {
  const dir = await makeFixture({ "a.txt": "hello\n" });
  t.after(() => cleanupFixture(dir));

  // This will still fail (no dotnet project), but we're testing that the option is accepted
  const result = await dotnetList(dir, { path: "MyProject.csproj" });
  assert.equal(result.success, false);
  assert.ok(typeof result.output === "string");
});

test("aborts an in-flight dotnet list via signal", async (t) => {
  const dir = await makeFixture({ "a.txt": "hello\n" });
  t.after(() => cleanupFixture(dir));

  const ac = new AbortController();
  const promise = dotnetList(dir, { signal: ac.signal });
  ac.abort();
  await assert.rejects(() => promise);
});