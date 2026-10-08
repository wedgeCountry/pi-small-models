/**
 * Pentest — correctness defects that weaken the sandbox's usefulness or integrity.
 *
 * These are the non-exploit findings from the review that are cleanly unit-testable. Each asserts
 * the intended behaviour and FAILS today.
 *
 *  - `search` silently drops custom ignore patterns (its options type has no `ignoreGlobs`, so the
 *    value the tool passes is discarded) → `.piignore` / `/ignore` do not apply to `search`.
 *  - `git_log` defaults to 1 commit in code while the docs/comment promise 10.
 *  - `find`/`grep` set `dot: false`, so dotfiles like `.github/**` can never be found or searched,
 *    even though they are not protected — inconsistent with `list`'s `showHidden`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { Sandbox } from "../../src/sandbox/sandbox.ts";
import { searchFiles } from "../../src/tools/search.ts";
import { findFiles } from "../../src/tools/find.ts";
import { gitLog } from "../../src/tools/git_log.ts";
import { makeFixture, cleanupFixture } from "../fixtures.ts";

test("search must honor custom ignore patterns (it currently drops ignoreGlobs)", async () => {
  const root = await makeFixture({ "keep.ts": "x\n", "skipme/secret.ts": "y\n" });
  try {
    const sb = new Sandbox(root); // sandbox ON
    // The registered tool passes getEffectiveIgnoreGlobs() here, but searchFiles never forwards it.
    const result = await searchFiles(sb, ".", "**/*.ts", { ignoreGlobs: ["**/skipme/**"] } as never);
    assert.equal(
      result.matches.some((m) => m.includes("skipme")),
      false,
      "BUG: `search` returned a file that a custom ignore pattern should have hidden"
    );
  } finally {
    await cleanupFixture(root);
  }
});

test("git_log default should return the documented 10 commits, not 1", async (t) => {
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
  const root = await makeFixture({ "f.txt": "0\n" });
  try {
    const git = (...args: string[]) =>
      execFileSync("git", ["-c", "user.email=a@b", "-c", "user.name=a", ...args], { cwd: root });
    git("init", "-q");
    for (let i = 0; i < 4; i++) {
      fs.writeFileSync(path.join(root, "f.txt"), `${i}\n`);
      git("add", "-A");
      git("commit", "-qm", `c${i}`);
    }
    const sb = new Sandbox(root);
    const result = await gitLog(sb, {});
    assert.ok(
      result.commits.length > 1,
      `BUG: git_log default returned ${result.commits.length} commit(s); docs/comment say the default is 10`
    );
  } finally {
    await cleanupFixture(root);
  }
});

test("find should locate non-protected dotfiles such as .github/** (dot:false hides them)", async () => {
  const root = await makeFixture({ ".github/workflows/ci.yml": "name: ci\n", "src/app.ts": "x\n" });
  try {
    const sb = new Sandbox(root);
    const result = await findFiles(sb, ".", "**/ci.yml");
    assert.ok(
      result.matches.some((m) => m.endsWith("ci.yml")),
      "BUG: find cannot see .github/** because of dot:false, though it is not a protected path"
    );
  } finally {
    await cleanupFixture(root);
  }
});
