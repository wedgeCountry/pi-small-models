/**
 * Pentest — Finding NEW-VENV (CRITICAL): .venv directory is not restricted
 * 
 * The .venv directory is NOT included in the RESTRICTED_GLOBS list, allowing
 * unrestricted access to Python virtual environment directories which can contain
 * sensitive credentials, API keys, and configuration files.
 * 
 * Secure expectation: .venv directories should be restricted like .git directories.
 * These tests verify that the fixes are working correctly.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { Sandbox, SandboxError } from "../../src/sandbox/sandbox.ts";
import { writeFile } from "../../src/tools/write.ts";
import { readFile } from "../../src/tools/read.ts";
import { makeFixture, cleanupFixture } from "../fixtures.ts";
import { isRestricted } from "../../src/sandbox/policy.ts";

// ============================================================================
// VENV DIRECTORY NOT RESTRICTED
// ============================================================================

test("NEW-VENV-1: .venv should be in RESTRICTED_GLOBS", () => {
  // This test verifies that .venv is properly restricted
  assert.equal(
    isRestricted(".venv"),
    true,
    "SECURITY: .venv directory should be restricted"
  );
});

test("NEW-VENV-2: .venv/subdir should be restricted", () => {
  assert.equal(
    isRestricted(".venv/subdir"),
    true,
    "SECURITY: .venv/subdir should be restricted"
  );
});

test("NEW-VENV-3: .venv/bin/activate should be restricted", () => {
  assert.equal(
    isRestricted(".venv/bin/activate"),
    true,
    "SECURITY: .venv/bin/activate should be restricted"
  );
});

test("NEW-VENV-4: Sandbox should block write to .venv/hello_world", async (t) => {
  const root = await makeFixture({ "src/index.ts": "export const x = 1;" });
  t.after(() => cleanupFixture(root));

  const sb = new Sandbox(root);

  // This should throw SandboxError with reason "restricted"
  await assert.rejects(
    async () => await writeFile(sb, ".venv/hello_world", "hello world"),
    (err: unknown) => {
      return err instanceof SandboxError && err.reason === "restricted";
    },
    "SECURITY: writeFile to .venv/hello_world should be blocked"
  );
});

test("NEW-VENV-5: Sandbox should block read from .venv/config", async (t) => {
  const root = await makeFixture({ ".venv/config": "secret=api_key_123" });
  t.after(() => cleanupFixture(root));

  const sb = new Sandbox(root);

  // This should throw SandboxError with reason "restricted"
  await assert.rejects(
    async () => await readFile(sb, ".venv/config"),
    (err: unknown) => {
      return err instanceof SandboxError && err.reason === "restricted";
    },
    "SECURITY: readFile from .venv/config should be blocked"
  );
});

test("NEW-VENV-6: Sandbox should block directory creation in .venv", async (t) => {
  const root = await makeFixture({ "src/index.ts": "export const x = 1;" });
  t.after(() => cleanupFixture(root));

  const sb = new Sandbox(root);

  // This should throw SandboxError with reason "restricted"
  assert.throws(
    () => sb.resolve(".venv"),
    (err: unknown) => {
      return err instanceof SandboxError && err.reason === "restricted";
    },
    "SECURITY: resolve of .venv directory should be blocked"
  );
});

test("NEW-VENV-7: Nested .venv in subdirectory should be restricted", () => {
  assert.equal(
    isRestricted("src/.venv"),
    true,
    "SECURITY: src/.venv should be restricted"
  );
});

test("NEW-VENV-8: .venv at any depth should be restricted", () => {
  assert.equal(
    isRestricted("a/b/c/.venv"),
    true,
    "SECURITY: a/b/c/.venv should be restricted"
  );
});