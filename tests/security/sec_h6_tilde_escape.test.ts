/**
 * Pentest — Finding H6 (High): tilde (~) expansion bypasses sandbox root containment.
 *
 * Node.js's `path.resolve()` expands `~` to the user's home directory (os.homedir()).
 * The sandbox's `resolve()` method uses `path.resolve(this.root, target)` which means
 * a path like `~/Documents/file` gets expanded to `/home/user/Documents/file` BEFORE
 * the sandbox checks if it's inside the project root.
 *
 * This allows writing/reading files outside the project root by using `~` notation.
 *
 * Secure expectation: paths containing `~` should be rejected or normalized to be
 * relative to the project root, not the home directory.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as os from "node:os";
import * as path from "node:path";
import { Sandbox, SandboxError } from "../../src/sandbox/sandbox.ts";
import { writeFile } from "../../src/tools/write.ts";
import { readFile } from "../../src/tools/read.ts";
import { makeFixture, cleanupFixture } from "../fixtures.ts";

// Use a test project root that is NOT the home directory
const testRoot = path.resolve("/tmp/pi-sandbox-test");

test("H6: tilde expansion should be blocked or resolved relative to project root", async (t) => {
  // Create a test fixture
  const root = await makeFixture({ "src/index.ts": "export const x = 1;" });
  t.after(() => cleanupFixture(root));

  const sb = new Sandbox(root); // sandbox ON

  // Test 1: Direct tilde path should be rejected
  await assert.rejects(
    async () => sb.resolve("~/test-file"),
    (err: unknown) => {
      return err instanceof SandboxError && err.reason === "outside-root";
    },
    "SECURITY: tilde path ~/test-file was not rejected by sandbox"
  );
});

test("H6: tilde in subpath should be blocked", async (t) => {
  const root = await makeFixture({ "src/index.ts": "export const x = 1;" });
  t.after(() => cleanupFixture(root));

  const sb = new Sandbox(root);

  // Test 2: Tilde in middle of path
  await assert.rejects(
    async () => sb.resolve("foo/~/bar"),
    (err: unknown) => err instanceof SandboxError && err.reason === "outside-root",
    "SECURITY: path with embedded tilde foo/~/bar was not rejected"
  );
});

test("H6: writeFile with tilde path should be blocked", async (t) => {
  const root = await makeFixture({ "src/index.ts": "export const x = 1;" });
  t.after(async () => {
    await cleanupFixture(root);
    // Clean up any file that was incorrectly created
    try {
      await fs.promises.unlink(path.join(os.homedir(), "test-file"));
    } catch {
      // ignore
    }
  });

  const sb = new Sandbox(root);

  // Test 3: Actual file operation with tilde
  await assert.rejects(
    () => writeFile(sb, "~/test-file", "test content"),
    (err: unknown) => err instanceof SandboxError && err.reason === "outside-root",
    "SECURITY: writeFile with ~/test-file was not blocked by sandbox"
  );
});

test("H6: readFile with tilde path should be blocked", async (t) => {
  const root = await makeFixture({ "src/index.ts": "export const x = 1;" });
  t.after(() => cleanupFixture(root));

  const sb = new Sandbox(root);

  // Test 4: Reading with tilde
  await assert.rejects(
    () => readFile(sb, "~/test-file"),
    (err: unknown) => err instanceof SandboxError && err.reason === "outside-root",
    "SECURITY: readFile with ~/test-file was not blocked by sandbox"
  );
});

// Import fs for cleanup
import * as fs from "node:fs";
