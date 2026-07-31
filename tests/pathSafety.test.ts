import { test } from "node:test";
import assert from "node:assert/strict";
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
