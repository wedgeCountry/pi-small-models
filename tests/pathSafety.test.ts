import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { resolveSafePath } from "../src/pathSafety.ts";

const root = path.resolve("/project");

test("resolves relative paths under the root", () => {
  assert.equal(resolveSafePath(root, "src"), path.resolve(root, "src"));
  assert.equal(resolveSafePath(root, "."), root);
  assert.equal(resolveSafePath(root, ""), root);
});

test("rejects paths that escape the root", () => {
  assert.throws(() => resolveSafePath(root, "../outside"));
  assert.throws(() => resolveSafePath(root, "../../etc/passwd"));
});

test("rejects absolute paths outside the root", () => {
  const outside = process.platform === "win32" ? "C:\\Windows" : "/etc";
  assert.throws(() => resolveSafePath(root, outside));
});

test("allows an absolute path that is inside the root", () => {
  const inside = path.join(root, "src", "index.ts");
  assert.equal(resolveSafePath(root, inside), inside);
});

test("rejects a symlink inside root that points outside it", async (t) => {
  const realRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pi-tools-root-"));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "pi-tools-outside-"));
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

  assert.throws(() => resolveSafePath(realRoot, "link/secret.txt"));
});

test("still allows a symlink inside root that points inside it", async (t) => {
  const realRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pi-tools-root-"));
  t.after(() => fs.rm(realRoot, { recursive: true, force: true }));

  await fs.mkdir(path.join(realRoot, "real-target"));
  const link = path.join(realRoot, "link");
  try {
    await fs.symlink(path.join(realRoot, "real-target"), link, "dir");
  } catch (err) {
    t.skip(`cannot create symlinks in this environment: ${(err as Error).message}`);
    return;
  }

  assert.equal(resolveSafePath(realRoot, "link/file.txt"), path.join(realRoot, "link", "file.txt"));
});

test("still resolves normally when root does not exist on disk (e.g. in unit tests)", () => {
  assert.equal(resolveSafePath(root, "src"), path.resolve(root, "src"));
});
