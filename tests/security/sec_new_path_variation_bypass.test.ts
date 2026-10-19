/**
 * Pentest — Finding NEW-PATH-VAR (MEDIUM): Path name variation bypass
 * 
 * Directory names that contain but don't exactly match restricted patterns
 * are allowed, including variations like .git., .git..., ..git, etc.
 * 
 * Secure expectation: Path variations that could be confused with restricted
 * patterns should also be blocked.
 * These tests verify that the fixes are working correctly.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { Sandbox, SandboxError } from "../../src/sandbox/sandbox.ts";
import { writeFile } from "../../src/tools/write.ts";
import { makeFixture, cleanupFixture } from "../fixtures.ts";
import { isRestricted } from "../../src/sandbox/policy.ts";

// ============================================================================
// PATH NAME VARIATION BYPASS
// ============================================================================

test("NEW-PATH-VAR-1: .git. (with trailing dot) should be restricted", () => {
  assert.equal(
    isRestricted(".git."),
    true,
    "SECURITY: .git. should be restricted"
  );
});

test("NEW-PATH-VAR-2: .git... (with multiple trailing dots) should be restricted", () => {
  assert.equal(
    isRestricted(".git..."),
    true,
    "SECURITY: .git... should be restricted"
  );
});

test("NEW-PATH-VAR-3: ..git (with leading dots) should be restricted", () => {
  assert.equal(
    isRestricted("..git"),
    true,
    "SECURITY: ..git should be restricted"
  );
});

test("NEW-PATH-VAR-4: ...git (with multiple leading dots) should be restricted", () => {
  assert.equal(
    isRestricted("...git"),
    true,
    "SECURITY: ...git should be restricted"
  );
});

test("NEW-PATH-VAR-5: .git. (directory) should be restricted", () => {
  assert.equal(
    isRestricted(".git./"),
    true,
    "SECURITY: .git./ should be restricted"
  );
});

test("NEW-PATH-VAR-6: .git.../ (directory) should be restricted", () => {
  assert.equal(
    isRestricted(".git.../"),
    true,
    "SECURITY: .git.../ should be restricted"
  );
});

test("NEW-PATH-VAR-7: Sandbox should block write to .git./hello_world", async (t) => {
  const root = await makeFixture({ "src/index.ts": "export const x = 1;" });
  t.after(() => cleanupFixture(root));

  const sb = new Sandbox(root);

  // This should throw SandboxError with reason "restricted"
  await assert.rejects(
    async () => await writeFile(sb, ".git./hello_world", "hello world"),
    (err: unknown) => {
      return err instanceof SandboxError && err.reason === "restricted";
    },
    "SECURITY: writeFile to .git./hello_world should be blocked"
  );
});

test("NEW-PATH-VAR-8: Sandbox should block write to .git.../hello_world", async (t) => {
  const root = await makeFixture({ "src/index.ts": "export const x = 1;" });
  t.after(() => cleanupFixture(root));

  const sb = new Sandbox(root);

  // This should throw SandboxError with reason "restricted"
  await assert.rejects(
    async () => await writeFile(sb, ".git.../hello_world", "hello world"),
    (err: unknown) => {
      return err instanceof SandboxError && err.reason === "restricted";
    },
    "SECURITY: writeFile to .git.../hello_world should be blocked"
  );
});

test("NEW-PATH-VAR-9: Sandbox should block write to ..git/hello_world", async (t) => {
  const root = await makeFixture({ "src/index.ts": "export const x = 1;" });
  t.after(() => cleanupFixture(root));

  const sb = new Sandbox(root);

  // This should throw SandboxError with reason "restricted"
  await assert.rejects(
    async () => await writeFile(sb, "..git/hello_world", "hello world"),
    (err: unknown) => {
      return err instanceof SandboxError && err.reason === "restricted";
    },
    "SECURITY: writeFile to ..git/hello_world should be blocked"
  );
});

test("NEW-PATH-VAR-10: Sandbox should block write to ...git/hello_world", async (t) => {
  const root = await makeFixture({ "src/index.ts": "export const x = 1;" });
  t.after(() => cleanupFixture(root));

  const sb = new Sandbox(root);

  // This should throw SandboxError with reason "restricted"
  await assert.rejects(
    async () => await writeFile(sb, "...git/hello_world", "hello world"),
    (err: unknown) => {
      return err instanceof SandboxError && err.reason === "restricted";
    },
    "SECURITY: writeFile to ...git/hello_world should be blocked"
  );
});

test("NEW-PATH-VAR-11: Nested path variations should be restricted", () => {
  const nestedVariations = [
    "src/.git.",
    "src/.git...",
    "src/..git",
    "src/...git",
    "a/b/.git.",
    "a/b/..git"
  ];
  
  for (const variation of nestedVariations) {
    assert.equal(
      isRestricted(variation),
      true,
      `SECURITY: ${variation} should be restricted`
    );
  }
});

test("NEW-PATH-VAR-12: node_modules path variations should be restricted", () => {
  const variations = [
    "node_modules.",
    "..node_modules",
    "...node_modules",
    "node_modules_backup"
  ];
  
  for (const variation of variations) {
    assert.equal(
      isRestricted(variation),
      true,
      `SECURITY: ${variation} should be restricted`
    );
  }
});

test("NEW-PATH-VAR-13: Sandbox should block resolve of path variations", async (t) => {
  const root = await makeFixture({ "src/index.ts": "export const x = 1;" });
  t.after(() => cleanupFixture(root));

  const sb = new Sandbox(root);

  const pathVariations = [".git.", ".git...", "..git", "...git", "node_modules.", "..node_modules"];
  
  for (const variation of pathVariations) {
    assert.throws(
      () => sb.resolve(`${variation}/hello_world`),
      (err: unknown) => {
        return err instanceof SandboxError && err.reason === "restricted";
      },
      `SECURITY: resolve of ${variation}/hello_world should be blocked`
    );
  }
});