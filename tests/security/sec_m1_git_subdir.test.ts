/**
 * Pentest — Finding M1 (Medium): git tools reach outside the sandbox root from a subdirectory.
 *
 * `git_status` / `git_diff` / `git_log` run against the whole repository even when the sandbox
 * root is a subdirectory of it. A model confined to `repo/sub` can read changes, history and file
 * names from `repo/` and its other subtrees.
 *
 * Secure expectation: with the root at `repo/sub`, git_diff shows only changes under that root.
 * FAILS today (the change to `repo/a.txt` appears). Skips without git.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { Sandbox } from "../../src/sandbox/sandbox.ts";
import { gitDiff } from "../../src/tools/git_diff.ts";
import { makeFixture, cleanupFixture } from "../fixtures.ts";

test("M1: git_diff rooted at repo/sub must not reveal changes outside that subdirectory", async (t) => {
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

  const repo = await makeFixture({
    "a.txt": "top-level file\n",
    "sub/b.txt": "in-scope file\n",
  });
  try {
    const git = (...args: string[]) =>
      execFileSync("git", ["-c", "user.email=a@b", "-c", "user.name=a", ...args], { cwd: repo });
    git("init", "-q");
    git("add", "-A");
    git("commit", "-qm", "init");
    // Change a file OUTSIDE the sandbox root.
    fs.writeFileSync(path.join(repo, "a.txt"), "top-level file CHANGED OUTSIDE ROOT\n");

    const sb = new Sandbox(path.join(repo, "sub")); // root is the subdirectory
    const result = await gitDiff(sb, {});

    assert.equal(
      result.text.includes("a.txt"),
      false,
      "SECURITY: git_diff from a subdirectory root disclosed a change to repo/a.txt (outside the root)"
    );
  } finally {
    await cleanupFixture(repo);
  }
});
