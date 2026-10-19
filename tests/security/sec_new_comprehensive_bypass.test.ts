/**
 * Pentest — Finding NEW-COMPREHENSIVE: Comprehensive bypass testing
 * 
 * This file contains comprehensive tests for all discovered vulnerabilities,
 * including combinations and edge cases that might not be covered by the
 * individual test files.
 * 
 * Secure expectation: All bypass attempts should be blocked.
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
// COMPREHENSIVE BYPASS TESTS
// ============================================================================

// Test 1: .venv directory bypass
test("COMPREHENSIVE-1: .venv directory should be restricted like .git", () => {
  assert.equal(
    isRestricted(".venv"),
    isRestricted(".git"),
    "SECURITY: .venv should have the same restriction level as .git"
  );
});

// Test 2: Case sensitivity + .venv combination
test("COMPREHENSIVE-2: .VENV (uppercase) should be restricted", () => {
  assert.equal(
    isRestricted(".VENV"),
    true,
    "SECURITY: .VENV should be restricted with case-insensitive matching"
  );
});

// Test 3: Unicode control + .git combination
test("COMPREHENSIVE-3: .git with various control characters should be blocked", () => {
  const sb = new Sandbox("/tmp/test");
  const controlChars = ["\u0001", "\u0002", "\t", "\n", "\r"];
  
  for (const char of controlChars) {
    const testPath = `.git${char}/test`;
    assert.throws(
      () => sb.resolve(testPath),
      (err: unknown) => {
        return err instanceof SandboxError && (err.reason === "restricted" || err.reason === "outside-root");
      },
      `SECURITY: Path with control character should be blocked`
    );
  }
});

// Test 4: Path variations + case sensitivity
test("COMPREHENSIVE-4: Case variations of path variations should be restricted", () => {
  const variations = [
    ".GIT.",
    ".Git.",
    ".GIT...",
    "..GIT",
    "...GIT"
  ];
  
  for (const variation of variations) {
    assert.equal(
      isRestricted(variation),
      true,
      `SECURITY: ${variation} should be restricted`
    );
  }
});

// Test 5: Nested .venv in .git-like directories
test("COMPREHENSIVE-5: .venv inside .GIT should be restricted", () => {
  assert.equal(
    isRestricted(".GIT/.venv"),
    true,
    "SECURITY: .GIT/.venv should be restricted"
  );
});

// Test 6: Multiple vulnerabilities combined
test("COMPREHENSIVE-6: .GIT with control character and path variation", () => {
  const sb = new Sandbox("/tmp/test");
  const combinedPaths = [
    ".GIT\u0001/hello",
    ".Git\t/world",
    "..GIT\n/test",
    ".GIT...\r/file"
  ];
  
  for (const combinedPath of combinedPaths) {
    assert.throws(
      () => sb.resolve(combinedPath),
      (err: unknown) => {
        return err instanceof SandboxError && (err.reason === "restricted" || err.reason === "outside-root");
      },
      `SECURITY: Combined bypass attempt should be blocked`
    );
  }
});

// Test 7: Real-world sensitive files in .venv
test("COMPREHENSIVE-7: Sensitive files in .venv should be restricted", () => {
  const sensitiveFiles = [
    ".venv/.env",
    ".venv/.env.local",
    ".venv/.env.production",
    ".venv/config.json",
    ".venv/secrets.json",
    ".venv/api_keys.json",
    ".venv/pyvenv.cfg"
  ];
  
  for (const file of sensitiveFiles) {
    assert.equal(
      isRestricted(file),
      true,
      `SECURITY: ${file} should be restricted`
    );
  }
});

// Test 8: Sensitive files in node_modules
test("COMPREHENSIVE-8: Sensitive files in node_modules should be restricted", () => {
  const sensitiveFiles = [
    "node_modules/.env",
    "node_modules/config.json",
    "node_modules/secrets.json",
    "node_modules/.npmrc",
    "node_modules/.yarnrc"
  ];
  
  for (const file of sensitiveFiles) {
    assert.equal(
      isRestricted(file),
      true,
      `SECURITY: ${file} should be restricted`
    );
  }
});

// Test 9: .git files inside .venv
test("COMPREHENSIVE-9: .git files inside .venv should be restricted", () => {
  const gitFilesInVenv = [
    ".venv/.git",
    ".venv/.git/config",
    ".venv/.git/HEAD"
  ];
  
  for (const file of gitFilesInVenv) {
    assert.equal(
      isRestricted(file),
      true,
      `SECURITY: ${file} should be restricted`
    );
  }
});

// Test 10: node_modules inside .venv
test("COMPREHENSIVE-10: node_modules inside .venv should be restricted", () => {
  const nodeModulesInVenv = [
    ".venv/node_modules",
    ".venv/node_modules/package"
  ];
  
  for (const file of nodeModulesInVenv) {
    assert.equal(
      isRestricted(file),
      true,
      `SECURITY: ${file} should be restricted`
    );
  }
});

// Test 11: Practical attack: Write sensitive data to .venv
test("COMPREHENSIVE-11: Practical attack: Write sensitive data to .venv", async (t) => {
  const root = await makeFixture({ "src/index.ts": "export const x = 1;" });
  t.after(() => cleanupFixture(root));

  const sb = new Sandbox(root);

  // This should throw SandboxError with reason "restricted"
  await assert.rejects(
    async () => await writeFile(sb, ".venv/.env", "API_KEY=secret123\nDB_PASSWORD=supersecret"),
    (err: unknown) => {
      return err instanceof SandboxError && err.reason === "restricted";
    },
    "SECURITY: Writing sensitive data to .venv/.env should be blocked"
  );
});

// Test 12: Practical attack: Read sensitive data from .venv
test("COMPREHENSIVE-12: Practical attack: Read sensitive data from .venv", async (t) => {
  const root = await makeFixture({ ".venv/.env": "API_KEY=secret123" });
  t.after(() => cleanupFixture(root));

  const sb = new Sandbox(root);

  // This should throw SandboxError with reason "restricted"
  await assert.rejects(
    async () => await readFile(sb, ".venv/.env"),
    (err: unknown) => {
      return err instanceof SandboxError && err.reason === "restricted";
    },
    "SECURITY: Reading sensitive data from .venv/.env should be blocked"
  );
});

// Test 13: Practical attack: Create .GIT directory to hide files
test("COMPREHENSIVE-13: Practical attack: Create .GIT directory to hide files", async (t) => {
  const root = await makeFixture({ "src/index.ts": "export const x = 1;" });
  t.after(() => cleanupFixture(root));

  const sb = new Sandbox(root);

  // This should throw SandboxError with reason "restricted"
  await assert.rejects(
    async () => await writeFile(sb, ".GIT/malicious_script.sh", "#!/bin/bash\nrm -rf /"),
    (err: unknown) => {
      return err instanceof SandboxError && err.reason === "restricted";
    },
    "SECURITY: Creating malicious script in .GIT should be blocked"
  );
});

// Test 14: Practical attack: Read sensitive data from node_modules
test("COMPREHENSIVE-14: Practical attack: Read sensitive data from node_modules", async (t) => {
  const root = await makeFixture({ "node_modules/.env": "API_KEY=secret123" });
  t.after(() => cleanupFixture(root));

  const sb = new Sandbox(root);

  // This should throw SandboxError with reason "restricted"
  await assert.rejects(
    async () => await readFile(sb, "node_modules/.env"),
    (err: unknown) => {
      return err instanceof SandboxError && err.reason === "restricted";
    },
    "SECURITY: Reading sensitive data from node_modules/.env should be blocked"
  );
});

// Test 15: Edge cases with multiple dots
test("COMPREHENSIVE-15: Multiple consecutive dots variations", () => {
  const dotVariations = [
    "..git",
    "...git",
    "....git",
    ".....git",
    ".git..",
    ".git...",
    ".git....",
    "..git..",
    "...git..."
  ];
  
  for (const variation of dotVariations) {
    assert.equal(
      isRestricted(variation),
      true,
      `SECURITY: ${variation} should be restricted`
    );
  }
});

// Test 16: Edge cases with special characters
test("COMPREHENSIVE-16: Special character combinations", () => {
  const specialCombinations = [
    ".git-",
    ".git_",
    ".git__",
    ".git-backup",
    ".git_old",
    ".git.bak",
    ".git.json",
    ".git.yaml"
  ];
  
  for (const combination of specialCombinations) {
    assert.equal(
      isRestricted(combination),
      true,
      `SECURITY: ${combination} should be restricted`
    );
  }
});

// Test 17: Deep nesting scenarios
test("COMPREHENSIVE-17: Deep nesting with vulnerabilities", () => {
  const deepPaths = [
    "a/b/c/d/e/.venv",
    "a/b/c/d/e/.GIT",
    "a/b/c/d/e/node_modules",
    "a/b/c/d/e/NODE_MODULES"
  ];
  
  for (const deepPath of deepPaths) {
    assert.equal(
      isRestricted(deepPath),
      true,
      `SECURITY: ${deepPath} should be restricted`
    );
  }
});

// Test 18: Relative path variations
test("COMPREHENSIVE-18: Relative path variations", () => {
  const sb = new Sandbox("/tmp/test");
  const relativePaths = [
    "./.git",
    "./.venv",
    "./node_modules"
  ];
  
  for (const relPath of relativePaths) {
    assert.throws(
      () => sb.resolve(relPath),
      (err: unknown) => {
        return err instanceof SandboxError && err.reason === "restricted";
      },
      `SECURITY: ${relPath} should be blocked`
    );
  }
});