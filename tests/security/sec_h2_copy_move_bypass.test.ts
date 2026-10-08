/**
 * Pentest — Finding H2 (High): protected files re-exposed by copying/moving a parent directory.
 *
 * `copyFile`/`moveFile` only check the top-level source and destination, then hand the whole tree
 * to `fs.cp` / `fs.rename`. A protected pattern that depends on a parent name (e.g.
 * `**/.config/gcloud/**`) stops matching once the parent is copied or renamed, so the restricted
 * file becomes readable at its new location. The same missing content check lets a recursive
 * remove/move delete or relocate a nested `.git` directory.
 *
 * Secure expectation: an operation that would expose/relocate/delete a protected entry is refused
 * (or skips it). These FAIL today.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Sandbox, SandboxError } from "../../src/sandbox/sandbox.ts";
import { copyFile } from "../../src/tools/copy.ts";
import { moveFile } from "../../src/tools/move.ts";
import { removePath } from "../../src/tools/remove.ts";
import { readFile } from "../../src/tools/read.ts";
import { makeFixture, cleanupFixture } from "../fixtures.ts";

test("H2: copying a parent directory must not expose a protected file inside it", async () => {
  const root = await makeFixture({
    ".config/gcloud/credentials.db": "SECRET-TOKEN-CONTENT",
    "README.md": "hi\n",
  });
  try {
    const sb = new Sandbox(root); // sandbox ON

    // Direct access is correctly refused…
    await assert.rejects(() => readFile(sb, ".config/gcloud/credentials.db"));

    // …but copying the unprotected parent is not, and the copy is then readable.
    let copyRefused = false;
    try {
      await copyFile(sb, ".config", "cfg", { recursive: true });
    } catch (err) {
      copyRefused = err instanceof SandboxError;
    }

    if (!copyRefused) {
      await assert.rejects(
        () => readFile(sb, "cfg/gcloud/credentials.db"),
        "SECURITY: a protected credential became readable after copying its parent directory"
      );
    }
  } finally {
    await cleanupFixture(root);
  }
});

test("H2: moving a parent directory must not expose a protected file inside it", async () => {
  const root = await makeFixture({
    ".config/gcloud/credentials.db": "SECRET-TOKEN-CONTENT",
  });
  try {
    const sb = new Sandbox(root);
    let moveRefused = false;
    try {
      await moveFile(sb, ".config", "cfg", { recursive: true });
    } catch (err) {
      moveRefused = err instanceof SandboxError;
    }
    if (!moveRefused) {
      await assert.rejects(
        () => readFile(sb, "cfg/gcloud/credentials.db"),
        "SECURITY: a protected credential became readable after moving its parent directory"
      );
    }
  } finally {
    await cleanupFixture(root);
  }
});

test("H2: a recursive remove must not delete a protected .git directory", async () => {
  const root = await makeFixture({
    "work/.git/config": "[remote]\n  url = https://user:token@example.com/repo.git\n",
    "work/src.ts": "export const x = 1;\n",
  });
  try {
    const sb = new Sandbox(root);
    await assert.rejects(
      () => removePath(sb, "work", { recursive: true }),
      (err: unknown) => err instanceof SandboxError && err.reason === "restricted",
      "SECURITY: a recursive remove deleted a protected .git directory (and its credential-bearing config)"
    );
  } finally {
    await cleanupFixture(root);
  }
});
