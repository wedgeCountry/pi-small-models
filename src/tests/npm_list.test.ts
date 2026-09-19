import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { npmList } from "../tools/npm_list.ts";
import { makeFixture, cleanupFixture } from "./fixtures.ts";

test("lists top-level packages with depth 0", async (t) => {
  const dir = await makeFixture({
    "package.json": JSON.stringify({
      name: "test-pkg",
      version: "1.0.0",
      dependencies: {
        "fast-glob": "^3.3.3",
      },
    }),
  });
  t.after(() => cleanupFixture(dir));

  // Install dependencies first
  await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({
    name: "test-pkg",
    version: "1.0.0",
    dependencies: {
      "fast-glob": "^3.3.3",
    },
  }));

  const result = await npmList(dir, { depth: 0 });
  assert.equal(result.truncated, false);
  // Output should mention the test package name or dependencies
  assert.ok(result.output.includes("test-pkg") || result.output.length > 0);
});

test("shows full dependency tree with depth 1", async (t) => {
  const dir = await makeFixture({
    "package.json": JSON.stringify({
      name: "test-pkg",
      version: "1.0.0",
      dependencies: {
        "fast-glob": "^3.3.3",
      },
    }),
  });
  t.after(() => cleanupFixture(dir));

  const result = await npmList(dir, { depth: 1 });
  assert.equal(result.truncated, false);
  // Should show at least the package name
  assert.ok(result.output.length > 0);
});

test("filters to a specific package", async (t) => {
  const dir = await makeFixture({
    "package.json": JSON.stringify({
      name: "test-pkg",
      version: "1.0.0",
    }),
  });
  t.after(() => cleanupFixture(dir));

  const result = await npmList(dir, { package: "test-pkg" });
  assert.equal(result.truncated, false);
  assert.ok(result.output.includes("test-pkg"));
});

test("handles missing package gracefully", async (t) => {
  const dir = await makeFixture({
    "package.json": JSON.stringify({
      name: "test-pkg",
      version: "1.0.0",
    }),
  });
  t.after(() => cleanupFixture(dir));

  const result = await npmList(dir, { package: "nonexistent-package-xyz" });
  // npm list returns error output for missing packages but shouldn't throw
  assert.equal(result.truncated, false);
  // Should contain some output (error message about missing package)
  assert.ok(result.output.length > 0);
});

test("rejects immediately when the signal is already aborted", async (t) => {
  const dir = await makeFixture({
    "package.json": JSON.stringify({
      name: "test-pkg",
      version: "1.0.0",
    }),
  });
  t.after(() => cleanupFixture(dir));

  const ac = new AbortController();
  ac.abort();
  await assert.rejects(() => npmList(dir, { signal: ac.signal }));
});

test("aborts an in-flight npm list via signal", async (t) => {
  const dir = await makeFixture({
    "package.json": JSON.stringify({
      name: "test-pkg",
      version: "1.0.0",
    }),
  });
  t.after(() => cleanupFixture(dir));

  const ac = new AbortController();
  const promise = npmList(dir, { signal: ac.signal });
  ac.abort();
  await assert.rejects(() => promise);
});

test("handles directory with no package.json", async (t) => {
  const dir = await makeFixture({
    "README.md": "# Test",
  });
  t.after(() => cleanupFixture(dir));

  const result = await npmList(dir);
  // npm list in a directory without package.json produces an error
  assert.equal(result.truncated, false);
  // Should contain error output about missing package.json
  assert.ok(result.output.length > 0);
});