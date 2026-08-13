import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  directoryIsSafe,
  fileIsSafe,
  resolveSandboxPath,
  isEntrySandboxSafe,
  getSandboxState,
  setSandboxState,
  cycleSandboxState,
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

test("resolveSandboxPath returns the resolved path on success and throws on violation", () => {
  assert.equal(resolveSandboxPath(root, "src/index.ts", "read"), path.resolve(root, "src/index.ts"));
  assert.throws(() => resolveSandboxPath(root, "../outside", "edit"), /outside the project root/);
  assert.throws(() => resolveSandboxPath(root, ".git/config", "edit"), /restricted in edit mode/);
});

test("state 'on' enforces both containment and restricted globs (the default)", (t) => {
  t.after(() => setSandboxState("on"));
  setSandboxState("on");

  assert.equal(getSandboxState(), "on");
  assert.equal(fileIsSafe(root, "../outside", "edit"), false);
  assert.equal(fileIsSafe(root, ".git/config", "edit"), false);
});

test("state 'off' keeps root containment but skips restricted-glob checks", (t) => {
  t.after(() => setSandboxState("on"));
  setSandboxState("off");

  assert.equal(getSandboxState(), "off");
  // Containment still enforced.
  assert.equal(fileIsSafe(root, "../outside", "edit"), false);
  assert.throws(() => resolveSandboxPath(root, "../outside", "edit"));
  // Restricted globs no longer enforced.
  assert.equal(fileIsSafe(root, ".git/config", "edit"), true);
  assert.equal(fileIsSafe(root, ".ssh/id_rsa", "read"), true);
  assert.equal(resolveSandboxPath(root, ".git/config", "edit"), path.resolve(root, ".git/config"));
});

test("state 'yolo' bypasses everything, including root containment", (t) => {
  t.after(() => setSandboxState("on"));
  setSandboxState("yolo");

  assert.equal(getSandboxState(), "yolo");
  assert.equal(fileIsSafe(root, "../outside", "edit"), true);
  assert.equal(fileIsSafe(root, ".git/config", "edit"), true);
  assert.doesNotThrow(() => resolveSandboxPath(root, "../outside", "edit"));
});

test("cycleSandboxState advances on -> off -> yolo -> on", (t) => {
  t.after(() => setSandboxState("on"));
  setSandboxState("on");

  assert.equal(cycleSandboxState(), "off");
  assert.equal(cycleSandboxState(), "yolo");
  assert.equal(cycleSandboxState(), "on");
});

test("isEntrySandboxSafe filters restricted entries during a directory walk, symlink or not", () => {
  assert.equal(isEntrySandboxSafe(root, ".ssh", "read", false), false);
  assert.equal(isEntrySandboxSafe(root, ".ssh/id_rsa", "read", false), false);
  assert.equal(isEntrySandboxSafe(root, "src/index.ts", "read", false), true);
  assert.equal(isEntrySandboxSafe(root, ".git/config", "edit", false), false);
  assert.equal(isEntrySandboxSafe(root, ".git/config", "read", false), true);
});

test("isEntrySandboxSafe respects sandbox state the same way resolveSandboxPath does", (t) => {
  t.after(() => setSandboxState("on"));

  setSandboxState("off");
  assert.equal(isEntrySandboxSafe(root, ".ssh/id_rsa", "read", false), true);

  setSandboxState("yolo");
  assert.equal(isEntrySandboxSafe(root, ".ssh/id_rsa", "read", false), true);
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

  // isEntrySandboxSafe against entries as find/grep/list's walks would produce them
  // (paths relative to the fixture root, exactly as fast-glob/readdir report them).
  assert.equal(isEntrySandboxSafe(dir, "src/index.ts", "read", false), true);
  assert.equal(isEntrySandboxSafe(dir, ".ssh/id_rsa", "read", false), false);
  assert.equal(isEntrySandboxSafe(dir, ".git/config", "edit", false), false);
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
  assert.equal(isEntrySandboxSafe(realRoot, "link/secret.txt", "read", true), false);
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
  assert.equal(isEntrySandboxSafe(realRoot, "totally-not-git/config", "edit", true), false);
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
  assert.equal(isEntrySandboxSafe(realRoot, "link/file.txt", "read", true), true);
});

test("still resolves normally when root does not exist on disk (e.g. in unit tests)", () => {
  assert.equal(fileIsSafe(root, "src/index.ts", "read"), true);
  assert.equal(fileIsSafe(root, ".git/config", "edit"), false);
});
