/**
 * Pentest — Finding H7 (High): Multiple path traversal and bypass vulnerabilities
 * 
 * Discovered through systematic testing of edge cases in sandbox path validation.
 * These tests demonstrate various ways to bypass the sandbox restrictions.
 * 
 * Secure expectation: All path traversal attempts should be blocked regardless
 * of the encoding or representation used.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { Sandbox, SandboxError } from "../../src/sandbox/sandbox.ts";
import { writeFile } from "../../src/tools/write.ts";
import { makeFixture, cleanupFixture } from "../fixtures.ts";

// Use a test project root
const testRoot = path.resolve("/tmp/pi-sandbox-h7-test");

// ============================================================================
// BACKSLASH PATH SEPARATOR BYPASS
// ============================================================================

test("H7-BACKSLASH-1: Backslash path separators should be normalized and then blocked", async (t) => {
  const root = await makeFixture({ "src/index.ts": "export const x = 1;" });
  t.after(() => cleanupFixture(root));

  const sb = new Sandbox(root);

  // Test 1: Backslash traversal gets normalized to "foo/../../secret.txt" which should be blocked
  await assert.rejects(
    async () => sb.resolve("foo\\..\\..\\secret.txt"),
    (err: unknown) => {
      return err instanceof SandboxError && err.reason === "outside-root";
    },
    "SECURITY: Backslash path traversal foo\\..\\..\\secret.txt was not rejected by sandbox after normalization"
  );
});

test("H7-BACKSLASH-2: Mixed path separators should be normalized and then blocked", async (t) => {
  const root = await makeFixture({ "src/index.ts": "export const x = 1;" });
  t.after(() => cleanupFixture(root));

  const sb = new Sandbox(root);

  // Test 2: Mixed forward and back slashes get normalized to "foo/../../secret.txt" which should be blocked
  await assert.rejects(
    async () => sb.resolve("foo/..\\..\\secret.txt"),
    (err: unknown) => {
      return err instanceof SandboxError && err.reason === "outside-root";
    },
    "SECURITY: Mixed separator path traversal foo/..\\..\\secret.txt was not rejected after normalization"
  );
});

test("H7-BACKSLASH-3: writeFile with backslash traversal should be blocked", async (t) => {
  const root = await makeFixture({ "src/index.ts": "export const x = 1;" });
  t.after(() => cleanupFixture(root));

  const sb = new Sandbox(root);

  // Test 3: Actual file operation with backslash traversal
  await assert.rejects(
    () => writeFile(sb, "foo\\..\\..\\test-file", "test content"),
    (err: unknown) => err instanceof SandboxError && err.reason === "outside-root",
    "SECURITY: writeFile with backslash traversal was not blocked by sandbox"
  );
});

test("H7-BACKSLASH-4: Backslash in filename (no traversal) should be normalized and allowed", async (t) => {
  const root = await makeFixture({ "src/index.ts": "export const x = 1;" });
  t.after(() => cleanupFixture(root));

  const sb = new Sandbox(root);

  // Test 4: Backslash as part of filename gets normalized to forward slash
  // "file\\name.txt" becomes "file/name.txt" which is a valid path inside root
  const result = sb.resolve("file\\name.txt");
  assert.equal(result, path.join(root, "file/name.txt"));
});

test("H7-BACKSLASH-5: Backslash without traversal should be normalized and allowed", async (t) => {
  const root = await makeFixture({ "src/index.ts": "export const x = 1;" });
  t.after(() => cleanupFixture(root));

  const sb = new Sandbox(root);

  // Test 5: "src\\index.ts" becomes "src/index.ts" which is valid
  const result = sb.resolve("src\\index.ts");
  assert.equal(result, path.join(root, "src/index.ts"));
});

// ============================================================================
// ENVIRONMENT VARIABLE SYNTAX BYPASS
// ============================================================================

test("H7-ENV-1: Environment variable syntax ($VAR) should be blocked", async (t) => {
  const root = await makeFixture({ "src/index.ts": "export const x = 1;" });
  t.after(() => cleanupFixture(root));

  const sb = new Sandbox(root);

  // Test 1: Unix-style environment variable
  await assert.rejects(
    async () => sb.resolve("$HOME/secret.txt"),
    (err: unknown) => {
      return err instanceof SandboxError && err.reason === "outside-root";
    },
    "SECURITY: Environment variable syntax $HOME/secret.txt was not rejected by sandbox"
  );
});

test("H7-ENV-2: Braced environment variable syntax (${VAR}) should be blocked", async (t) => {
  const root = await makeFixture({ "src/index.ts": "export const x = 1;" });
  t.after(() => cleanupFixture(root));

  const sb = new Sandbox(root);

  // Test 2: Braced environment variable
  await assert.rejects(
    async () => sb.resolve("${HOME}/secret.txt"),
    (err: unknown) => {
      return err instanceof SandboxError && err.reason === "outside-root";
    },
    "SECURITY: Braced environment variable syntax ${HOME}/secret.txt was not rejected"
  );
});

test("H7-ENV-3: Windows environment variable syntax (%VAR%) should be blocked", async (t) => {
  const root = await makeFixture({ "src/index.ts": "export const x = 1;" });
  t.after(() => cleanupFixture(root));

  const sb = new Sandbox(root);

  // Test 3: Windows-style environment variable
  await assert.rejects(
    async () => sb.resolve("%USERPROFILE%\\secret.txt"),
    (err: unknown) => {
      return err instanceof SandboxError && err.reason === "outside-root";
    },
    "SECURITY: Windows environment variable syntax %USERPROFILE% was not rejected"
  );
});

test("H7-ENV-4: writeFile with environment variable syntax should be blocked", async (t) => {
  const root = await makeFixture({ "src/index.ts": "export const x = 1;" });
  t.after(() => cleanupFixture(root));

  const sb = new Sandbox(root);

  // Test 4: Actual file operation with env var syntax
  await assert.rejects(
    () => writeFile(sb, "$HOME/test-file", "test content"),
    (err: unknown) => err instanceof SandboxError && err.reason === "outside-root",
    "SECURITY: writeFile with $HOME/test-file was not blocked by sandbox"
  );
});

// ============================================================================
// UNICODE PATH SEPARATOR BYPASS
// ============================================================================

test("H7-UNICODE-1: Full-width slash (U+FF0F) should be blocked", async (t) => {
  const root = await makeFixture({ "src/index.ts": "export const x = 1;" });
  t.after(() => cleanupFixture(root));

  const sb = new Sandbox(root);

  // Test 1: Full-width forward slash (／)
  await assert.rejects(
    async () => sb.resolve("foo／／..／secret.txt"),
    (err: unknown) => {
      return err instanceof SandboxError && err.reason === "outside-root";
    },
    "SECURITY: Full-width slash path traversal was not rejected by sandbox"
  );
});

test("H7-UNICODE-2: Unicode ellipsis (U+2026) should be blocked", async (t) => {
  const root = await makeFixture({ "src/index.ts": "export const x = 1;" });
  t.after(() => cleanupFixture(root));

  const sb = new Sandbox(root);

  // Test 2: Ellipsis character that looks like ../
  await assert.rejects(
    async () => sb.resolve("..…/secret.txt"),
    (err: unknown) => {
      return err instanceof SandboxError && err.reason === "outside-root";
    },
    "SECURITY: Unicode ellipsis path traversal was not rejected by sandbox"
  );
});

// ============================================================================
// PATH NORMALIZATION BYPASS
// ============================================================================

test("H7-NORMALIZE-1: Paths with . and .. should be normalized before validation", async (t) => {
  const root = await makeFixture({ "src/index.ts": "export const x = 1;" });
  t.after(() => cleanupFixture(root));

  const sb = new Sandbox(root);

  // Test 1a: foo/../bar/../secret.txt should resolve to secret.txt (inside root) - ALLOWED
  const result1 = sb.resolve("foo/../bar/../secret.txt");
  assert.equal(result1, path.join(root, "secret.txt"));

  // Test 1b: foo/../../secret.txt should be blocked (escapes root)
  await assert.rejects(
    async () => sb.resolve("foo/../../secret.txt"),
    (err: unknown) => {
      return err instanceof SandboxError && err.reason === "outside-root";
    },
    "SECURITY: Normalized path traversal foo/../../secret.txt was not rejected"
  );
});

test("H7-NORMALIZE-2: Paths with ./ should be normalized correctly", async (t) => {
  const root = await makeFixture({ "src/index.ts": "export const x = 1;" });
  t.after(() => cleanupFixture(root));

  const sb = new Sandbox(root);

  // Test 2: foo/./../bar/./../secret.txt resolves to secret.txt (inside root)
  // This should be ALLOWED as it doesn't escape the sandbox
  const result = sb.resolve("foo/./../bar/./../secret.txt");
  assert.equal(result, path.join(root, "secret.txt"));
});

test("H7-NORMALIZE-3: Multiple consecutive slashes should be normalized", async (t) => {
  const root = await makeFixture({ "src/index.ts": "export const x = 1;" });
  t.after(() => cleanupFixture(root));

  const sb = new Sandbox(root);

  // Test 3: foo//..//..//secret.txt should be blocked
  await assert.rejects(
    async () => sb.resolve("foo//..//..//secret.txt"),
    (err: unknown) => {
      return err instanceof SandboxError && err.reason === "outside-root";
    },
    "SECURITY: Multiple slash path traversal was not rejected"
  );
});

// ============================================================================
// ABSOLUTE PATH BYPASS
// ============================================================================

test("H7-ABSOLUTE-1: Absolute paths starting with project root should be blocked", async (t) => {
  const root = await makeFixture({ "src/index.ts": "export const x = 1;" });
  t.after(() => cleanupFixture(root));

  const sb = new Sandbox(root);

  // Test 1: Absolute path that starts with project root but has traversal
  await assert.rejects(
    async () => sb.resolve(path.join(root, "..", "secret.txt")),
    (err: unknown) => {
      return err instanceof SandboxError && err.reason === "outside-root";
    },
    "SECURITY: Absolute path with traversal was not rejected by sandbox"
  );
});

test("H7-ABSOLUTE-2: Multiple leading slashes should be blocked", async (t) => {
  const root = await makeFixture({ "src/index.ts": "export const x = 1;" });
  t.after(() => cleanupFixture(root));

  const sb = new Sandbox(root);

  // Test 2: Multiple leading slashes
  await assert.rejects(
    async () => sb.resolve("///etc/passwd"),
    (err: unknown) => {
      return err instanceof SandboxError && err.reason === "outside-root";
    },
    "SECURITY: Multiple leading slashes path was not rejected"
  );
});

// ============================================================================
// SPECIAL CHARACTER BYPASS
// ============================================================================

test("H7-SPECIAL-1: Paths containing only dots should be handled correctly", async (t) => {
  const root = await makeFixture({ "src/index.ts": "export const x = 1;" });
  t.after(() => cleanupFixture(root));

  const sb = new Sandbox(root);

  // Test 1: Path that is just dots
  await assert.rejects(
    async () => sb.resolve(".."),
    (err: unknown) => {
      return err instanceof SandboxError && err.reason === "outside-root";
    },
    "SECURITY: Single dot-dot path was not rejected"
  );
});

test("H7-SPECIAL-2: Paths with dots in filename should be allowed if inside root", async (t) => {
  const root = await makeFixture({ "src/index.ts": "export const x = 1;" });
  t.after(() => cleanupFixture(root));

  const sb = new Sandbox(root);

  // Test 2: This should be allowed - it's a valid filename
  // Note: This test should PASS (not reject) as it's a valid file inside root
  const result = sb.resolve("..filename");
  assert.ok(result.includes("..filename"));
});

test("H7-SPECIAL-3: Paths ending with .. should resolve correctly", async (t) => {
  const root = await makeFixture({ "src/index.ts": "export const x = 1;" });
  t.after(() => cleanupFixture(root));

  const sb = new Sandbox(root);

  // Test 3: foo/.. resolves to root, which is inside the sandbox
  // This should be ALLOWED
  const result = sb.resolve("foo/..");
  assert.equal(result, root);
});

// ============================================================================
// ADDITIONAL ESCAPE ATTEMPTS
// ============================================================================

test("H7-ESCAPE-1: Deep traversal should be blocked", async (t) => {
  const root = await makeFixture({ "src/index.ts": "export const x = 1;" });
  t.after(() => cleanupFixture(root));

  const sb = new Sandbox(root);

  // Test 1: Deep traversal with many ..
  await assert.rejects(
    async () => sb.resolve("../../../../../../etc/passwd"),
    (err: unknown) => {
      return err instanceof SandboxError && err.reason === "outside-root";
    },
    "SECURITY: Deep path traversal was not rejected"
  );
});

test("H7-ESCAPE-2: Traversal with file in middle should be blocked", async (t) => {
  const root = await makeFixture({ "src/index.ts": "export const x = 1;" });
  t.after(() => cleanupFixture(root));

  const sb = new Sandbox(root);

  // Test 2: Traversal with file components
  await assert.rejects(
    async () => sb.resolve("foo/../bar/../../secret.txt"),
    (err: unknown) => {
      return err instanceof SandboxError && err.reason === "outside-root";
    },
    "SECURITY: Path traversal with file components was not rejected"
  );
});

// ============================================================================
// EDGE CASE: Empty and special path components
// ============================================================================

test("H7-EDGE-1: Empty path should resolve to root", async (t) => {
  const root = await makeFixture({ "src/index.ts": "export const x = 1;" });
  t.after(() => cleanupFixture(root));

  const sb = new Sandbox(root);

  // Test 1: Empty path should resolve to root
  const result = sb.resolve("");
  assert.equal(result, root);
});

test("H7-EDGE-2: Dot path should resolve to root", async (t) => {
  const root = await makeFixture({ "src/index.ts": "export const x = 1;" });
  t.after(() => cleanupFixture(root));

  const sb = new Sandbox(root);

  // Test 2: Dot path should resolve to root
  const result = sb.resolve(".");
  assert.equal(result, root);
});
