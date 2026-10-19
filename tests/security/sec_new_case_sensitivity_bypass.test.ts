/**
 * Pentest — Finding NEW-CASE (HIGH): Case sensitivity bypass on Linux
 * 
 * On Linux systems, the sandbox uses case-sensitive matching, allowing
 * directories with case variations of restricted names (like .GIT, .Git, .gIt)
 * to bypass the restrictions.
 * 
 * Secure expectation: Case variations of restricted patterns should also be blocked.
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
// CASE SENSITIVITY BYPASS
// ============================================================================

test("NEW-CASE-1: .GIT (uppercase) should be restricted", () => {
  // This should be restricted with case-insensitive matching
  assert.equal(
    isRestricted(".GIT"),
    true,
    "SECURITY: .GIT should be restricted with case-insensitive matching"
  );
});

test("NEW-CASE-2: .Git (mixed case) should be restricted", () => {
  // This should be restricted with case-insensitive matching
  assert.equal(
    isRestricted(".Git"),
    true,
    "SECURITY: .Git should be restricted with case-insensitive matching"
  );
});

test("NEW-CASE-3: .gIt (mixed case) should be restricted", () => {
  // This should be restricted with case-insensitive matching
  assert.equal(
    isRestricted(".gIt"),
    true,
    "SECURITY: .gIt should be restricted with case-insensitive matching"
  );
});

test("NEW-CASE-4: .gIT (mixed case) should be restricted", () => {
  // This should be restricted with case-insensitive matching
  assert.equal(
    isRestricted(".gIT"),
    true,
    "SECURITY: .gIT should be restricted with case-insensitive matching"
  );
});

test("NEW-CASE-5: Sandbox should block write to .GIT/hello_world", async (t) => {
  const root = await makeFixture({ "src/index.ts": "export const x = 1;" });
  t.after(() => cleanupFixture(root));

  const sb = new Sandbox(root);

  // This should throw SandboxError with reason "restricted"
  await assert.rejects(
    async () => await writeFile(sb, ".GIT/hello_world", "hello world"),
    (err: unknown) => {
      return err instanceof SandboxError && err.reason === "restricted";
    },
    "SECURITY: writeFile to .GIT/hello_world should be blocked"
  );
});

test("NEW-CASE-6: Sandbox should block write to .Git/hello_world", async (t) => {
  const root = await makeFixture({ "src/index.ts": "export const x = 1;" });
  t.after(() => cleanupFixture(root));

  const sb = new Sandbox(root);

  // This should throw SandboxError with reason "restricted"
  await assert.rejects(
    async () => await writeFile(sb, ".Git/hello_world", "hello world"),
    (err: unknown) => {
      return err instanceof SandboxError && err.reason === "restricted";
    },
    "SECURITY: writeFile to .Git/hello_world should be blocked"
  );
});

test("NEW-CASE-7: Sandbox should block resolve of .GIT directory", async (t) => {
  const root = await makeFixture({ "src/index.ts": "export const x = 1;" });
  t.after(() => cleanupFixture(root));

  const sb = new Sandbox(root);

  // This should throw SandboxError with reason "restricted"
  assert.throws(
    () => sb.resolve(".GIT"),
    (err: unknown) => {
      return err instanceof SandboxError && err.reason === "restricted";
    },
    "SECURITY: resolve of .GIT directory should be blocked"
  );
});

test("NEW-CASE-8: Nested case variations should be restricted", () => {
  assert.equal(
    isRestricted("src/.GIT"),
    true,
    "SECURITY: src/.GIT should be restricted with case-insensitive matching"
  );
});

test("NEW-CASE-9: .GIT at any depth should be restricted", () => {
  assert.equal(
    isRestricted("a/b/c/.GIT"),
    true,
    "SECURITY: a/b/c/.GIT should be restricted with case-insensitive matching"
  );
});

test("NEW-CASE-10: All case variations of .git should be restricted", () => {
  const caseVariations = [".GIT", ".Git", ".gIt", ".gIT", ".GiT", ".giT"];
  
  for (const variation of caseVariations) {
    assert.equal(
      isRestricted(variation),
      true,
      `SECURITY: ${variation} should be restricted with case-insensitive matching`
    );
  }
});

test("NEW-CASE-11: Case variations of node_modules should be restricted", () => {
  const caseVariations = ["NODE_MODULES", "Node_Modules", "node_modules", "NODE_MODULES"];
  
  for (const variation of caseVariations) {
    assert.equal(
      isRestricted(variation),
      true,
      `SECURITY: ${variation} should be restricted with case-insensitive matching`
    );
  }
});

test("NEW-CASE-12: Case variations of .venv should be restricted", () => {
  const caseVariations = [".VENV", ".Venv", ".venV", ".VENV"];
  
  for (const variation of caseVariations) {
    assert.equal(
      isRestricted(variation),
      true,
      `SECURITY: ${variation} should be restricted with case-insensitive matching`
    );
  }
});