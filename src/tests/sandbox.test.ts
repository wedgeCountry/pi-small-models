import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  directoryIsSafe,
  fileIsSafe,
  isSandboxEnabled,
  setSandboxEnabled,
  toggleSandbox,
  READ_RESTRICTED_GLOBS,
  EDIT_RESTRICTED_GLOBS,
} from "../sandbox.ts";
import { makeFixture, cleanupFixture } from "./fixtures.ts";

const root = path.resolve("/project");

test("the project root itself is safe in both modes", () => {
  assert.equal(directoryIsSafe(root, ".", "read"), true);
  assert.equal(directoryIsSafe(root, "", "edit"), true);
  assert.equal(fileIsSafe(root, ".", "read"), true);
});

test("an ordinary child path is safe in both modes", () => {
  assert.equal(fileIsSafe(root, "src/index.ts", "read"), true);
  assert.equal(fileIsSafe(root, "src/index.ts", "edit"), true);
  assert.equal(directoryIsSafe(root, "src", "read"), true);
});

test("rejects paths that escape the root, regardless of mode", () => {
  assert.equal(directoryIsSafe(root, "../outside", "read"), false);
  assert.equal(directoryIsSafe(root, "../outside", "edit"), false);
  assert.equal(fileIsSafe(root, "../../etc/passwd", "read"), false);
});

test("rejects absolute paths outside the root", () => {
  const outside = process.platform === "win32" ? "C:\\Windows" : "/etc";
  assert.equal(fileIsSafe(root, outside, "edit"), false);
});

test("edit mode restricts .git but not .ssh", () => {
  assert.equal(fileIsSafe(root, ".git/config", "edit"), false);
  assert.equal(directoryIsSafe(root, ".git", "edit"), false);
  assert.equal(fileIsSafe(root, ".ssh/id_rsa", "edit"), true);
});

test("read mode restricts .ssh but not .git", () => {
  assert.equal(fileIsSafe(root, ".ssh/id_rsa", "read"), false);
  assert.equal(directoryIsSafe(root, ".ssh", "read"), false);
  assert.equal(fileIsSafe(root, ".git/config", "read"), true);
});

test("both modes restrict .env files", () => {
  assert.equal(fileIsSafe(root, ".env", "read"), false);
  assert.equal(fileIsSafe(root, ".env", "edit"), false);
  assert.equal(fileIsSafe(root, ".env.local", "read"), false);
  assert.equal(fileIsSafe(root, ".env.local", "edit"), false);
});

test("read mode also restricts .aws and .netrc", () => {
  assert.equal(fileIsSafe(root, ".aws/credentials", "read"), false);
  assert.equal(fileIsSafe(root, ".netrc", "read"), false);
});

test("restricted globs apply regardless of nesting depth", () => {
  assert.equal(fileIsSafe(root, "packages/api/.git/config", "edit"), false);
  assert.equal(fileIsSafe(root, "packages/api/.env", "read"), false);
  assert.equal(fileIsSafe(root, "nested/deep/.ssh/id_rsa", "read"), false);
});

test("restricted glob lists are exactly what each mode advertises", () => {
  assert.deepEqual([...EDIT_RESTRICTED_GLOBS], ["**/.git/**", "**/.env*"]);
  assert.deepEqual([...READ_RESTRICTED_GLOBS], ["**/.ssh/**", "**/.aws/**", "**/.env*", "**/.netrc"]);
});

test("case sensitivity of restricted globs matches the current platform", () => {
  const caseInsensitive = process.platform === "win32" || process.platform === "darwin";
  assert.equal(fileIsSafe(root, ".SSH/id_rsa", "read"), !caseInsensitive);
});

test("toggling the sandbox off bypasses both containment and restricted-glob checks", (t) => {
  t.after(() => setSandboxEnabled(true));

  assert.equal(isSandboxEnabled(), true);
  assert.equal(toggleSandbox(), false);
  assert.equal(isSandboxEnabled(), false);

  assert.equal(directoryIsSafe(root, "../outside", "edit"), true);
  assert.equal(fileIsSafe(root, ".git/config", "edit"), true);
  assert.equal(fileIsSafe(root, ".ssh/id_rsa", "read"), true);

  assert.equal(toggleSandbox(), true);
  assert.equal(isSandboxEnabled(), true);
});

test("setSandboxEnabled sets the flag directly", (t) => {
  t.after(() => setSandboxEnabled(true));

  setSandboxEnabled(false);
  assert.equal(isSandboxEnabled(), false);
  assert.equal(fileIsSafe(root, "../outside", "read"), true);

  setSandboxEnabled(true);
  assert.equal(isSandboxEnabled(), true);
  assert.equal(fileIsSafe(root, "../outside", "read"), false);
});

test("works against a real fixture tree", async (t) => {
  const dir = await makeFixture({
    "src/index.ts": "export {};",
    ".git/config": "[core]",
    ".ssh/id_rsa": "not a real key",
    ".env": "SECRET=1",
  });
  t.after(() => cleanupFixture(dir));

  assert.equal(fileIsSafe(dir, "src/index.ts", "read"), true);
  assert.equal(fileIsSafe(dir, ".git/config", "edit"), false);
  assert.equal(fileIsSafe(dir, ".git/config", "read"), true);
  assert.equal(fileIsSafe(dir, ".ssh/id_rsa", "read"), false);
  assert.equal(fileIsSafe(dir, ".ssh/id_rsa", "edit"), true);
  assert.equal(fileIsSafe(dir, ".env", "read"), false);
  assert.equal(fileIsSafe(dir, ".env", "edit"), false);
});

test("rejects a symlink inside root that points outside it, regardless of mode", async (t) => {
  const realRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pi-tools-sandbox-root-"));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "pi-tools-sandbox-outside-"));
  await fs.writeFile(path.join(outside, "secret.txt"), "top secret", "utf8");
  t.after(async () => {
    await fs.rm(realRoot, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  });

  const link = path.join(realRoot, "link");
  try {
    await fs.symlink(outside, link, "dir");
  } catch (err) {
    t.skip(`cannot create symlinks in this environment: ${(err as Error).message}`);
    return;
  }

  assert.equal(fileIsSafe(realRoot, "link/secret.txt", "read"), false);
  assert.equal(fileIsSafe(realRoot, "link/secret.txt", "edit"), false);
});

test("catches a symlink that points at a restricted directory under a disguised name", async (t) => {
  const realRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pi-tools-sandbox-root-"));
  t.after(() => fs.rm(realRoot, { recursive: true, force: true }));

  await fs.mkdir(path.join(realRoot, ".git"));
  await fs.writeFile(path.join(realRoot, ".git", "config"), "[core]", "utf8");

  const link = path.join(realRoot, "totally-not-git");
  try {
    await fs.symlink(path.join(realRoot, ".git"), link, "dir");
  } catch (err) {
    t.skip(`cannot create symlinks in this environment: ${(err as Error).message}`);
    return;
  }

  // The lexical name ("totally-not-git") wouldn't match "**/.git/**" on its own —
  // only resolving the symlink's real target catches it.
  assert.equal(fileIsSafe(realRoot, "totally-not-git/config", "edit"), false);
  // .git isn't restricted in read mode, so the same symlink is fine there.
  assert.equal(fileIsSafe(realRoot, "totally-not-git/config", "read"), true);
});

test("still allows a symlink inside root that points to an unrestricted target inside it", async (t) => {
  const realRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pi-tools-sandbox-root-"));
  t.after(() => fs.rm(realRoot, { recursive: true, force: true }));

  await fs.mkdir(path.join(realRoot, "real-target"));
  const link = path.join(realRoot, "link");
  try {
    await fs.symlink(path.join(realRoot, "real-target"), link, "dir");
  } catch (err) {
    t.skip(`cannot create symlinks in this environment: ${(err as Error).message}`);
    return;
  }

  assert.equal(fileIsSafe(realRoot, "link/file.txt", "read"), true);
  assert.equal(directoryIsSafe(realRoot, "link", "edit"), true);
});

test("still resolves normally when root does not exist on disk (e.g. in unit tests)", () => {
  assert.equal(fileIsSafe(root, "src/index.ts", "read"), true);
  assert.equal(fileIsSafe(root, ".git/config", "edit"), false);
});
