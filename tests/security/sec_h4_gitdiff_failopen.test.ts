/**
 * Pentest — Finding H4 (High): git_diff's secret filter fails open.
 *
 * `filterRestrictedDiffChunks` splits on `diff --git a/… b/…` headers and, if none match, returns
 * the raw diff UNFILTERED by design. The widely used git setting `diff.mnemonicPrefix = true`
 * changes the prefixes to `i/… w/…`, so no header matches and an uncommitted `.env` change is
 * disclosed in full.
 *
 * Secure expectation: a tracked, protected file's contents never appear in git_diff output,
 * regardless of the user's git configuration. The test FAILS today under mnemonicPrefix.
 *
 * Skips when git is unavailable.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { Sandbox } from "../../src/sandbox/sandbox.ts";
import { gitDiff } from "../../src/tools/git_diff.ts";
import { makeFixture, cleanupFixture } from "../fixtures.ts";

const SECRET = "API_KEY=super-secret-value-123";

test("H4: git_diff must not leak a tracked .env even with diff.mnemonicPrefix=true", async (t) => {
  let hasGit = true;
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
  } catch {
    hasGit = false;
  }
  if (!hasGit) {
    t.skip("git unavailable");
    return;
  }

  const root = await makeFixture({ ".env": "API_KEY=old\n", "app.ts": "export const x = 1;\n" });
  const gitconfig = path.join(root, "pentest.gitconfig");
  const prev = process.env.GIT_CONFIG_GLOBAL;
  try {
    const git = (...args: string[]) =>
      execFileSync("git", ["-c", "user.email=a@b", "-c", "user.name=a", ...args], { cwd: root });
    git("init", "-q");
    git("add", "-A");
    git("commit", "-qm", "init");
    // Uncommitted change to the tracked secret.
    fs.writeFileSync(path.join(root, ".env"), SECRET + "\n");

    // The user has this common option in their global git config.
    fs.writeFileSync(gitconfig, "[diff]\n\tmnemonicPrefix = true\n");
    process.env.GIT_CONFIG_GLOBAL = gitconfig;

    const sb = new Sandbox(root); // sandbox ON
    const result = await gitDiff(sb, {});

    assert.equal(
      result.text.includes(SECRET),
      false,
      "SECURITY: git_diff disclosed the contents of a tracked .env under diff.mnemonicPrefix"
    );
  } finally {
    if (prev === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = prev;
    await cleanupFixture(root);
  }
});
