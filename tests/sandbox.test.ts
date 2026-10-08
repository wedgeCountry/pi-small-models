import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { RESTRICTED_GLOBS, isInside, isRestricted } from "../src/sandbox/policy.ts";
import { Sandbox, SandboxError, getSandboxState, sandboxFor, setSandboxState } from "../src/sandbox/sandbox.ts";
import { makeFixture, cleanupFixture } from "./fixtures.ts";

// A root that does not exist on disk: the lexical checks must still work (B2, B3).
const root = path.resolve("/project");
const sandbox = new Sandbox(root);

const CASE_INSENSITIVE = process.platform === "win32" || process.platform === "darwin";

async function trySymlink(t: { skip(msg: string): void }, target: string, link: string): Promise<boolean> {
  try {
    await fs.symlink(target, link, "dir");
    return true;
  } catch (err) {
    t.skip(`cannot create symlinks here: ${(err as Error).message}`);
    return false;
  }
}

function rejection(fn: () => unknown): SandboxError["reason"] | undefined {
  try {
    fn();
    return undefined;
  } catch (err) {
    assert.ok(err instanceof SandboxError, `expected SandboxError, got ${String(err)}`);
    return err.reason;
  }
}

// --- policy.ts -------------------------------------------------------------------------------

test("policy: the protected patterns are exactly the credential stores plus .git", () => {
  assert.deepEqual(
    [...RESTRICTED_GLOBS],
    [
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
      "**/.git/**",
    ]
  );
});

test("policy: isRestricted matches at any depth and leaves ordinary files alone", () => {
  const restricted = [
    ".env",
    ".env.local",
    "packages/api/.env",
    ".ssh/id_rsa",
    "nested/deep/.ssh/config",
    ".aws/credentials",
    ".netrc",
    ".npmrc",
    ".pgpass",
    ".docker/config.json",
    ".kube/config",
    ".gnupg/private-keys-v1.d/foo",
    ".config/gcloud/credentials.db",
    "id_rsa",
    "deploy/id_ed25519",
    "id_dsa",
    "id_ecdsa",
    ".git/config",
    "packages/api/.git/HEAD",
  ];
  for (const rel of restricted) assert.equal(isRestricted(rel), true, rel);

  for (const rel of ["src/index.ts", "id_rsa.pub", ".config/other/x", "README.md", ""]) {
    assert.equal(isRestricted(rel), false, rel);
  }
});

test("policy: case sensitivity follows the platform's filesystem", () => {
  assert.equal(isRestricted(".SSH/config"), CASE_INSENSITIVE);
});

test("policy: isInside rejects parent escapes and absolute paths", () => {
  assert.equal(isInside(""), true);
  assert.equal(isInside("src/a.ts"), true);
  assert.equal(isInside("..foo"), true); // a file name starting with dots is still inside
  assert.equal(isInside(".."), false);
  assert.equal(isInside(`..${path.sep}x`), false);
  assert.equal(isInside(path.resolve("/elsewhere")), false);
});

// --- B1: state switch ------------------------------------------------------------------------

test("B1: the switch starts on, and sandboxFor snapshots it per call", (t) => {
  t.after(() => setSandboxState("on"));
  assert.equal(getSandboxState(), "on");
  assert.equal(sandboxFor(root).enforced, true);

  const snapshot = sandboxFor(root);
  setSandboxState("off");
  assert.equal(snapshot.enforced, true, "a sandbox already handed out keeps its state");
  assert.equal(sandboxFor(root).enforced, false);
});

// --- B2: root containment --------------------------------------------------------------------

test("B2: resolve returns absolute paths inside the root", () => {
  assert.equal(sandbox.resolve(""), root);
  assert.equal(sandbox.resolve("."), root);
  assert.equal(sandbox.resolve("src/index.ts"), path.join(root, "src", "index.ts"));
  assert.equal(sandbox.resolve(path.join(root, "src")), path.join(root, "src"));
});

test("B2: resolve rejects parent escapes and absolute paths outside the root", () => {
  assert.equal(rejection(() => sandbox.resolve("../outside")), "outside-root");
  assert.equal(rejection(() => sandbox.resolve("../../etc/passwd")), "outside-root");
  assert.equal(rejection(() => sandbox.resolve(process.platform === "win32" ? "C:\\Windows" : "/etc")), "outside-root");
});

test("B2: resolve rejects an in-root symlink that points outside, even for files not yet created", async (t) => {
  const dir = await makeFixture({ "project/src/a.ts": "", "outside/secret.txt": "x" });
  t.after(() => cleanupFixture(dir));
  const project = path.join(dir, "project");
  if (!(await trySymlink(t, path.join(dir, "outside"), path.join(project, "link")))) return;

  const sb = new Sandbox(project);
  assert.equal(rejection(() => sb.resolve("link/secret.txt")), "outside-root");
  assert.equal(rejection(() => sb.resolve("link/not-yet/new.txt")), "outside-root");
});

test("B2: resolve allows an in-root symlink that points inside", async (t) => {
  const dir = await makeFixture({ "real-target/file.txt": "ok" });
  t.after(() => cleanupFixture(dir));
  if (!(await trySymlink(t, path.join(dir, "real-target"), path.join(dir, "link")))) return;

  assert.equal(new Sandbox(dir).resolve("link/file.txt"), path.join(dir, "link", "file.txt"));
});

test("B2: relative gives the checked path relative to the root", () => {
  assert.equal(sandbox.relative("."), "");
  assert.equal(sandbox.relative("src/a.ts"), path.join("src", "a.ts"));
  assert.equal(rejection(() => sandbox.relative("../x")), "outside-root");
});

// --- B3: protected paths ---------------------------------------------------------------------

test("B3: resolve rejects protected paths, at any depth", () => {
  for (const target of [".git", ".git/config", ".ssh/id_rsa", ".env", "packages/api/.env", ".config/gcloud/x"]) {
    assert.equal(rejection(() => sandbox.resolve(target)), "restricted", target);
  }
  assert.equal(sandbox.resolve("id_rsa.pub"), path.join(root, "id_rsa.pub"));
});

test("B3: a symlink with an innocent name pointing at .git is caught by its real path", async (t) => {
  const dir = await makeFixture({ ".git/config": "[core]" });
  t.after(() => cleanupFixture(dir));
  if (!(await trySymlink(t, path.join(dir, ".git"), path.join(dir, "totally-not-git")))) return;

  assert.equal(rejection(() => new Sandbox(dir).resolve("totally-not-git/config")), "restricted");
});

// --- B4: walk entries ------------------------------------------------------------------------

test("B4: entryFilter drops protected entries and keeps ordinary ones", () => {
  const allow = sandbox.entryFilter(root);
  assert.equal(allow("src/index.ts", false), true);
  assert.equal(allow(".ssh", false), false);
  assert.equal(allow(".ssh/id_rsa", false), false);
  assert.equal(allow(".git/config", false), false);
  assert.equal(allow(path.join(root, ".env"), false), false, "absolute entry paths work too");
});

test("B4: entryFilter matches relative to the project root, not the walked folder", () => {
  const allow = sandbox.entryFilter(path.join(root, ".config"));
  assert.equal(allow("gcloud/credentials.db", false), false);
  assert.equal(allow("other/settings.json", false), true);
});

test("B4: entryFilter drops symlinks that escape the root or are broken, keeps in-root ones", async (t) => {
  const dir = await makeFixture({ "project/real/file.txt": "ok", "outside/secret.txt": "x" });
  t.after(() => cleanupFixture(dir));
  const project = path.join(dir, "project");
  if (!(await trySymlink(t, path.join(dir, "outside"), path.join(project, "escape")))) return;
  await fs.symlink(path.join(project, "real"), path.join(project, "inside"), "dir");
  await fs.symlink(path.join(project, "missing"), path.join(project, "broken"), "dir");

  await fs.symlink(path.join(project, "real/file.txt"), path.join(project, ".env"));

  const allow = new Sandbox(project).entryFilter(project);
  assert.equal(allow("escape", true), false);
  assert.equal(allow("broken", true), false);
  assert.equal(allow("inside", true), true);
  assert.equal(allow(".env", true), false, "a protected name is refused even if its target is harmless");
});

test("B4: entryFilter checks entries under a symlinked base by their real location", async (t) => {
  const dir = await makeFixture({ ".config/gcloud/credentials.db": "x" });
  t.after(() => cleanupFixture(dir));
  if (!(await trySymlink(t, path.join(dir, ".config"), path.join(dir, "cfg")))) return;

  const sb = new Sandbox(dir);
  const allow = sb.entryFilter(sb.resolve("cfg"));
  assert.equal(allow("gcloud/credentials.db", false), false);
});

// --- B5: paths reported by other programs ----------------------------------------------------

test("B5: allowsReported filters root-relative paths by the protected patterns", () => {
  assert.equal(sandbox.allowsReported("src/a.ts"), true);
  assert.equal(sandbox.allowsReported(".env"), false);
  assert.equal(sandbox.allowsReported("config/.git/HEAD"), false);
});

// --- B6: unenforced sandbox ------------------------------------------------------------------

test("B6: an unenforced sandbox checks nothing", () => {
  const off = new Sandbox(root, false);
  assert.equal(off.resolve("../outside"), path.resolve(root, "../outside"));
  assert.equal(off.resolve(".git/config"), path.join(root, ".git", "config"));
  assert.equal(off.entryFilter(root)(".ssh/id_rsa", true), true);
  assert.equal(off.allowsReported(".env"), true);
  assert.equal(off.resolveLibraryFile([], "/anywhere/x.py"), path.resolve("/anywhere/x.py"));
});

// --- B7: error messages ----------------------------------------------------------------------

test("B7: errors say which check failed", () => {
  assert.throws(() => sandbox.resolve("../outside"), /Path "\.\.\/outside" is outside the project root/);
  assert.throws(() => sandbox.resolve(".git/config"), /Path "\.git\/config" is restricted by the sandbox/);
});

test("B7: escaping the root wins over a protected name", () => {
  assert.equal(rejection(() => sandbox.resolve("../elsewhere/.env")), "outside-root");
});

// --- B8: installed-package locations ---------------------------------------------------------

test("B8: resolveLibraryFile allows files under a library root and rejects everything else", async (t) => {
  const dir = await makeFixture({ "libs/pkg/a.py": "", "libs/pkg/.env": "SECRET=1", "elsewhere/b.py": "" });
  t.after(() => cleanupFixture(dir));
  const sb = new Sandbox(path.join(dir, "project"));
  const roots = [path.join(dir, "libs")];

  assert.equal(sb.resolveLibraryFile(roots, path.join(dir, "libs/pkg/a.py")), path.join(dir, "libs/pkg/a.py"));
  assert.throws(
    () => sb.resolveLibraryFile(roots, path.join(dir, "elsewhere/b.py")),
    /Library file ".*b\.py" is outside the installed-package locations this tool may read/
  );
  assert.throws(() => sb.resolveLibraryFile(roots, path.join(dir, "libs/../elsewhere/b.py")), /outside/);
  assert.throws(() => sb.resolveLibraryFile(roots, path.join(dir, "libs/pkg/.env")), /Library file .* is restricted by the sandbox/);
  assert.equal(sb.allowsLibraryFile(roots, path.join(dir, "libs/pkg/a.py")), true);
  assert.equal(sb.allowsLibraryFile(roots, path.join(dir, "elsewhere/b.py")), false);
});

test("B8: a symlink inside a library root that escapes it is rejected", async (t) => {
  const dir = await makeFixture({ "libs/.keep": "", "elsewhere/b.py": "" });
  t.after(() => cleanupFixture(dir));
  if (!(await trySymlink(t, path.join(dir, "elsewhere"), path.join(dir, "libs/escape")))) return;

  const sb = new Sandbox(dir);
  assert.equal(sb.allowsLibraryFile([path.join(dir, "libs")], path.join(dir, "libs/escape/b.py")), false);
});
