import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Sandbox, sandboxFor, setSandboxState } from "../src/sandbox/sandbox.ts";
import { isEntrySandboxSafe } from "../src/sandbox/sandbox.ts";
import { makeFixture, cleanupFixture } from "./fixtures.ts";

// Helper to create test fixtures
async function trySymlink(t: { skip(msg: string): void }, target: string, link: string, type?: string): Promise<boolean> {
  try {
    await fs.symlink(target, link, type);
    return true;
  } catch (err) {
    t.skip(`cannot create symlinks here: ${(err as Error).message}`);
    return false;
  }
}

// Helper to create a temp directory with files
async function makeTempDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "pi-tools-test-"));
}

// ============================================================================
// hasRestrictedDescendant Tests - CRITICAL SECURITY FUNCTION
// ============================================================================

test("hasRestrictedDescendant: returns false for empty directory", async () => {
  const dir = await makeTempDir();
  const emptyDir = path.join(dir, "empty");
  await fs.mkdir(emptyDir, { recursive: true });
  
  const sb = new Sandbox(dir);
  assert.equal(await sb.hasRestrictedDescendant(emptyDir), false);
  
  await cleanupFixture(dir);
});

test("hasRestrictedDescendant: returns false for directory with only safe files", async () => {
  const dir = await makeFixture({
    "safe/src/index.ts": "const x = 1;",
    "safe/src/utils.ts": "export function helper() {}",
  });
  const sb = new Sandbox(dir);
  
  assert.equal(await sb.hasRestrictedDescendant(path.join(dir, "safe")), false);
  await cleanupFixture(dir);
});

test("hasRestrictedDescendant: returns true for directory containing .env file", async () => {
  const dir = await makeFixture({
    "project/.env": "SECRET=value",
    "project/src/index.ts": "const x = 1;",
  });
  const sb = new Sandbox(dir);
  
  assert.equal(await sb.hasRestrictedDescendant(path.join(dir, "project")), true);
  await cleanupFixture(dir);
});

test("hasRestrictedDescendant: returns true for directory containing .ssh directory", async () => {
  const dir = await makeFixture({
    "project/.ssh/config": "Host github.com",
    "project/src/index.ts": "const x = 1;",
  });
  const sb = new Sandbox(dir);
  
  assert.equal(await sb.hasRestrictedDescendant(path.join(dir, "project")), true);
  await cleanupFixture(dir);
});

test("hasRestrictedDescendant: returns true for nested restricted files", async () => {
  const dir = await makeFixture({
    "project/src/.git/config": "[core]",
    "project/src/utils.ts": "export function helper() {}",
  });
  const sb = new Sandbox(dir);
  
  assert.equal(await sb.hasRestrictedDescendant(path.join(dir, "project")), true);
  await cleanupFixture(dir);
});

test("hasRestrictedDescendant: returns true for directory containing .aws directory", async () => {
  const dir = await makeFixture({
    "project/.aws/credentials": "[default]",
    "project/src/index.ts": "const x = 1;",
  });
  const sb = new Sandbox(dir);
  
  assert.equal(await sb.hasRestrictedDescendant(path.join(dir, "project")), true);
  await cleanupFixture(dir);
});

test("hasRestrictedDescendant: returns true for directory containing .config/gcloud", async () => {
  const dir = await makeFixture({
    "project/.config/gcloud/credentials.db": "secret",
    "project/src/index.ts": "const x = 1;",
  });
  const sb = new Sandbox(dir);
  
  assert.equal(await sb.hasRestrictedDescendant(path.join(dir, "project")), true);
  await cleanupFixture(dir);
});

test("hasRestrictedDescendant: returns false when sandbox is off", async () => {
  const dir = await makeFixture({
    "project/.env": "SECRET=value",
    "project/src/index.ts": "const x = 1;",
  });
  const sb = new Sandbox(dir, false); // Sandbox off
  
  assert.equal(await sb.hasRestrictedDescendant(path.join(dir, "project")), false);
  await cleanupFixture(dir);
});

test("hasRestrictedDescendant: handles symlinks to restricted directories", async (t) => {
  const dir = await makeFixture({
    "project/.env": "SECRET=value",
    "project/src/index.ts": "const x = 1;",
  });
  t.after(() => cleanupFixture(dir));
  
  if (!(await trySymlink(t, path.join(dir, "project", ".env"), path.join(dir, "project", "my-config")))) return;
  
  const sb = new Sandbox(dir);
  // The symlink "my-config" points to ".env" which is restricted
  // The symlink target's real path should be checked and found restricted
  assert.equal(await sb.hasRestrictedDescendant(path.join(dir, "project")), true);
});

test("hasRestrictedDescendant: handles symlinks to directories with restricted content", async (t) => {
  const dir = await makeFixture({
    "project/real/.env": "SECRET=value",
    "project/src/index.ts": "const x = 1;",
  });
  t.after(() => cleanupFixture(dir));
  
  if (!(await trySymlink(t, path.join(dir, "project", "real"), path.join(dir, "project", "my-link")))) return;
  
  const sb = new Sandbox(dir);
  // The symlink "my-link" points to "real" which contains .env
  // Walking into my-link should find the .env file in the real directory
  assert.equal(await sb.hasRestrictedDescendant(path.join(dir, "project")), true);
});

test("hasRestrictedDescendant: handles broken symlinks gracefully", async (t) => {
  const dir = await makeFixture({
    "project/src/index.ts": "const x = 1;",
  });
  t.after(() => cleanupFixture(dir));
  
  if (!(await trySymlink(t, "/nonexistent/target", path.join(dir, "project", "broken-link")))) return;
  
  const sb = new Sandbox(dir);
  // Broken symlink should not cause errors, just be skipped
  // Note: The symlink name "broken-link" is not restricted, so it should pass
  assert.equal(await sb.hasRestrictedDescendant(path.join(dir, "project")), false);
});

test("hasRestrictedDescendant: terminates on symlink pointing to ancestor directory", async (t) => {
  const dir = await makeFixture({
    "project/src/index.ts": "const x = 1;",
  });
  t.after(() => cleanupFixture(dir));

  // A symlink pointing at an ancestor directory: without cycle detection the
  // walk recurses into the same directory forever (stack overflow).
  if (!(await trySymlink(t, "..", path.join(dir, "project", "src", "back")))) return;

  const sb = new Sandbox(dir);
  assert.equal(await sb.hasRestrictedDescendant(path.join(dir, "project")), false);
});

test("hasRestrictedDescendant: terminates on symlink cycle between directories", async (t) => {
  const dir = await makeFixture({
    "project/a/keep.txt": "a",
    "project/b/keep.txt": "b",
  });
  t.after(() => cleanupFixture(dir));

  if (!(await trySymlink(t, "../b", path.join(dir, "project", "a", "to-b")))) return;
  if (!(await trySymlink(t, "../a", path.join(dir, "project", "b", "to-a")))) return;

  const sb = new Sandbox(dir);
  assert.equal(await sb.hasRestrictedDescendant(path.join(dir, "project")), false);
});

test("hasRestrictedDescendant: still detects restricted content through symlink cycle", async (t) => {
  const dir = await makeFixture({
    "project/a/keep.txt": "a",
    "project/b/.env": "SECRET=1",
  });
  t.after(() => cleanupFixture(dir));

  if (!(await trySymlink(t, "../b", path.join(dir, "project", "a", "to-b")))) return;
  if (!(await trySymlink(t, "../a", path.join(dir, "project", "b", "to-a")))) return;

  const sb = new Sandbox(dir);
  assert.equal(await sb.hasRestrictedDescendant(path.join(dir, "project")), true);
});

test("hasRestrictedDescendant: checks the directory itself", async () => {
  const dir = await makeFixture({
    "project/.git/config": "[core]",
  });
  const sb = new Sandbox(dir);
  
  // The .git directory itself should be caught when checking its parent
  assert.equal(await sb.hasRestrictedDescendant(path.join(dir, "project")), true);
  
  // Checking the .git directory itself should also return true since it contains restricted files
  assert.equal(await sb.hasRestrictedDescendant(path.join(dir, "project", ".git")), true);
  
  await cleanupFixture(dir);
});

// ============================================================================
// isEntrySandboxSafe Tests
// ============================================================================

test("isEntrySandboxSafe: returns true for safe entries", () => {
  const root = path.resolve("/project");
  
  assert.equal(isEntrySandboxSafe(root, root, "src/index.ts", false), true);
  assert.equal(isEntrySandboxSafe(root, root, "utils/helper.ts", false), true);
});

test("isEntrySandboxSafe: returns false for restricted entries", () => {
  const root = path.resolve("/project");
  
  assert.equal(isEntrySandboxSafe(root, root, ".env", false), false);
  assert.equal(isEntrySandboxSafe(root, root, ".ssh/id_rsa", false), false);
  assert.equal(isEntrySandboxSafe(root, root, ".git/config", false), false);
});

test("isEntrySandboxSafe: respects stateOverride parameter", () => {
  const root = path.resolve("/project");
  
  // With stateOverride="off", should allow restricted entries
  assert.equal(isEntrySandboxSafe(root, root, ".env", false, "off"), true);
  
  // With stateOverride="on", should block restricted entries
  assert.equal(isEntrySandboxSafe(root, root, ".env", false, "on"), false);
});

test("isEntrySandboxSafe: returns false for restricted entries", () => {
  const root = path.resolve("/project");
  
  // Restricted file names should be blocked
  assert.equal(isEntrySandboxSafe(root, root, ".ssh", false), false);
  assert.equal(isEntrySandboxSafe(root, root, ".env", false), false);
  assert.equal(isEntrySandboxSafe(root, root, ".git/config", false), false);
  
  // Safe file names should be allowed
  assert.equal(isEntrySandboxSafe(root, root, "src/index.ts", false), true);
  assert.equal(isEntrySandboxSafe(root, root, "utils/helper.ts", false), true);
});

// ============================================================================
// Helper Function Tests
// ============================================================================

// We can't directly test private helper functions, but we can test their behavior
// through the public API

test("resolve handles non-existent paths correctly", () => {
  const root = path.resolve("/project");
  const sb = new Sandbox(root);
  
  // Non-existent path should still be validated
  const resolved = sb.resolve("src/newfile.ts");
  assert.equal(resolved, path.join(root, "src", "newfile.ts"));
});

test("resolve handles deeply nested non-existent paths", () => {
  const root = path.resolve("/project");
  const sb = new Sandbox(root);
  
  // Deeply nested non-existent path
  const resolved = sb.resolve("a/b/c/d/e/f.ts");
  assert.equal(resolved, path.join(root, "a", "b", "c", "d", "e", "f.ts"));
});

test("resolve blocks non-existent paths outside root", () => {
  const root = path.resolve("/project");
  const sb = new Sandbox(root);
  
  assert.throws(() => sb.resolve("../outside/file.ts"), /is outside the project root/);
});

test("resolve blocks non-existent restricted paths", () => {
  const root = path.resolve("/project");
  const sb = new Sandbox(root);
  
  assert.throws(() => sb.resolve(".git/config"), /is restricted by the sandbox/);
  assert.throws(() => sb.resolve(".env"), /is restricted by the sandbox/);
  assert.throws(() => sb.resolve(".ssh/id_rsa"), /is restricted by the sandbox/);
});

// ============================================================================
// Integration Tests for Refactored walkDirectoryForRestricted
// ============================================================================

test("hasRestrictedDescendant uses entryFilter internally for consistency", async () => {
  const dir = await makeFixture({
    "project/.env": "SECRET=value",
    "project/.ssh/config": "Host github.com",
    "project/src/index.ts": "const x = 1;",
    "project/src/utils.ts": "export function helper() {}",
    "project/safe/safe.ts": "const y = 2;",
  });
  const sb = new Sandbox(dir);
  
  // Both .env and .ssh should be caught
  assert.equal(await sb.hasRestrictedDescendant(path.join(dir, "project")), true);
  
  // Safe subdirectory should pass
  assert.equal(await sb.hasRestrictedDescendant(path.join(dir, "project", "safe")), false);
  
  await cleanupFixture(dir);
});

test("hasRestrictedDescendant: multiple levels of nesting", async () => {
  const dir = await makeFixture({
    "project/a/b/c/d/.env": "SECRET=value",
    "project/a/b/c/safe.ts": "const x = 1;",
  });
  const sb = new Sandbox(dir);
  
  assert.equal(await sb.hasRestrictedDescendant(path.join(dir, "project")), true);
  assert.equal(await sb.hasRestrictedDescendant(path.join(dir, "project", "a")), true);
  assert.equal(await sb.hasRestrictedDescendant(path.join(dir, "project", "a", "b")), true);
  assert.equal(await sb.hasRestrictedDescendant(path.join(dir, "project", "a", "b", "c")), true);
  
  await cleanupFixture(dir);
});

test("hasRestrictedDescendant: various restricted file types", async () => {
  const restrictedFiles = [
    ".env",
    ".env.local", 
    ".env.production",
    ".netrc",
    ".npmrc",
    ".pgpass",
    ".pypirc",
    ".yarnrc.yml",
    "server.pem",
    "private.key",
    "keystore.p12",
    "terraform.tfstate",
    "id_rsa",
    "id_dsa",
    "id_ecdsa",
    "id_ed25519",
  ];
  
  for (const file of restrictedFiles) {
    const dir = await makeFixture({
      [`project/${file}`]: "secret content",
      "project/src/index.ts": "const x = 1;",
    });
    const sb = new Sandbox(dir);
    
    assert.equal(
      await sb.hasRestrictedDescendant(path.join(dir, "project")),
      true,
      `Should detect restricted file: ${file}`
    );
    
    await cleanupFixture(dir);
  }
});

test("hasRestrictedDescendant: various restricted directories", async () => {
  const restrictedDirs = [
    ".ssh",
    ".aws",
    ".docker",
    ".kube",
    ".gnupg",
    ".config/gcloud",
    ".config/gh",
    ".git",
    ".terraform",
    ".pi",
    ".agents",
  ];
  
  for (const dirName of restrictedDirs) {
    const dir = await makeFixture({
      [`project/${dirName}/config`]: "secret content",
      "project/src/index.ts": "const x = 1;",
    });
    const sb = new Sandbox(dir);
    
    assert.equal(
      await sb.hasRestrictedDescendant(path.join(dir, "project")),
      true,
      `Should detect restricted directory: ${dirName}`
    );
    
    await cleanupFixture(dir);
  }
});

// ============================================================================
// Edge Cases and Performance
// ============================================================================

test("hasRestrictedDescendant: large directory with no restricted files", async () => {
  const dir = await makeFixture({
    "project/src/file1.ts": "const x1 = 1;",
    "project/src/file2.ts": "const x2 = 2;",
    "project/src/file3.ts": "const x3 = 3;",
    "project/src/file4.ts": "const x4 = 4;",
    "project/src/file5.ts": "const x5 = 5;",
    "project/utils/helper1.ts": "export function h1() {}",
    "project/utils/helper2.ts": "export function h2() {}",
    "project/utils/helper3.ts": "export function h3() {}",
    "project/utils/helper4.ts": "export function h4() {}",
    "project/utils/helper5.ts": "export function h5() {}",
  });
  const sb = new Sandbox(dir);
  
  // Should complete without errors and return false
  assert.equal(await sb.hasRestrictedDescendant(path.join(dir, "project")), false);
  
  await cleanupFixture(dir);
});

test("hasRestrictedDescendant: mixed content with restricted at various levels", async () => {
  const dir = await makeFixture({
    "project/src/index.ts": "const x = 1;",
    "project/src/config.ts": "export const x = 1;",
    "project/utils/helper.ts": "export function h() {}",
    "project/config/settings.json": "{}",
  });
  const sb = new Sandbox(dir);
  
  // First, verify safe directory returns false
  assert.equal(await sb.hasRestrictedDescendant(path.join(dir, "project")), false);
  
  await cleanupFixture(dir);
});
