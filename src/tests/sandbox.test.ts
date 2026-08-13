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

test("edit mode restricts .git and .ssh", () => {
  assert.equal(fileIsSafe(root, ".git/config", "edit"), false);
  assert.equal(directoryIsSafe(root, ".git", "edit"), false);
  assert.equal(fileIsSafe(root, ".ssh/id_rsa", "edit"), false);
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

test("both modes restrict the broader credential-store additions", () => {
  for (const mode of ["read", "edit"] as const) {
    assert.equal(fileIsSafe(root, ".npmrc", mode), false);
    assert.equal(fileIsSafe(root, ".pgpass", mode), false);
    assert.equal(fileIsSafe(root, ".docker/config.json", mode), false);
    assert.equal(fileIsSafe(root, ".kube/config", mode), false);
    assert.equal(fileIsSafe(root, ".gnupg/private-keys-v1.d/foo", mode), false);
    assert.equal(fileIsSafe(root, ".config/gcloud/credentials.db", mode), false);
    assert.equal(fileIsSafe(root, "id_rsa", mode), false);
    assert.equal(fileIsSafe(root, "deploy/id_ed25519", mode), false);
  }
  // Public keys aren't secret and aren't covered by the bare-filename patterns.
  assert.equal(fileIsSafe(root, "id_rsa.pub", "read"), true);
});

test("restricted globs apply regardless of nesting depth", () => {
  assert.equal(fileIsSafe(root, "packages/api/.git/config", "edit"), false);
  assert.equal(fileIsSafe(root, "packages/api/.env", "read"), false);
  assert.equal(fileIsSafe(root, "nested/deep/.ssh/id_rsa", "read"), false);
});

test("restricted glob lists are exactly what each mode advertises", () => {
  const credentialGlobs = [
    "**/.ssh/**",
    "**/.aws/**",
    "**/.env*",
    "**/.netrc",
    "**/.npmrc",
    "**/.pgpass",
    "**/.docker/**",
    "**/.kube/**",
    "**/.gnupg/**",
    "**/.config/gcloud/**",
    "**/id_rsa",
    "**/id_dsa",
    "**/id_ecdsa",
    "**/id_ed25519",
  ];
  assert.deepEqual([...READ_RESTRICTED_GLOBS], credentialGlobs);
  // Edit mode is a superset of read mode's credential globs, plus .git/** (repo-state protection,
  // not a credential/disclosure concern, so it isn't in READ_RESTRICTED_GLOBS).
  assert.deepEqual([...EDIT_RESTRICTED_GLOBS], [...credentialGlobs, "**/.git/**"]);
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

test("state 'off' bypasses everything, including root containment", (t) => {
  t.after(() => setSandboxState("on"));
  setSandboxState("off");

  assert.equal(getSandboxState(), "off");
  assert.equal(fileIsSafe(root, "../outside", "edit"), true);
  assert.equal(fileIsSafe(root, ".git/config", "edit"), true);
  assert.equal(fileIsSafe(root, ".ssh/id_rsa", "read"), true);
  assert.doesNotThrow(() => resolveSandboxPath(root, "../outside", "edit"));
  assert.equal(resolveSandboxPath(root, ".git/config", "edit"), path.resolve(root, ".git/config"));
});

test("cycleSandboxState toggles on <-> off", (t) => {
  t.after(() => setSandboxState("on"));
  setSandboxState("on");

  assert.equal(cycleSandboxState(), "off");
  assert.equal(cycleSandboxState(), "on");
  assert.equal(cycleSandboxState(), "off");
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
});

test("isEntrySandboxSafe's stateOverride wins over this module's own sandboxState", (t) => {
  t.after(() => setSandboxState("on"));

  // Module state says "on" (restricted), but an explicit "off" override — as grepWorker.ts must
  // pass, since its own import of this module starts from a separate, independent "on" — bypasses
  // everything, and vice versa.
  setSandboxState("on");
  assert.equal(isEntrySandboxSafe(root, ".ssh/id_rsa", "read", false, "off"), true);

  setSandboxState("off");
  assert.equal(isEntrySandboxSafe(root, ".ssh/id_rsa", "read", false, "on"), false);

  // No override falls back to this module's own current state, as before.
  setSandboxState("on");
  assert.equal(isEntrySandboxSafe(root, ".ssh/id_rsa", "read", false), false);
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
  assert.equal(fileIsSafe(dir, ".ssh/id_rsa", "edit"), false);
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
