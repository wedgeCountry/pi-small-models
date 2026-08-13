import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { gitDiff } from "../tools/git_diff.ts";
import { makeFixture, cleanupFixture, initGitRepo } from "./fixtures.ts";

const execFile = promisify(execFileCb);

test("reports no changes for a clean repo", async (t) => {
  const dir = await makeFixture({ "a.txt": "hello\n" });
  await initGitRepo(dir);
  t.after(() => cleanupFixture(dir));

  const result = await gitDiff(dir);
  assert.equal(result.text, "");
  assert.equal(result.truncated, false);
});

test("shows unstaged changes", async (t) => {
  const dir = await makeFixture({ "a.txt": "hello\n" });
  await initGitRepo(dir);
  t.after(() => cleanupFixture(dir));

  await fs.writeFile(path.join(dir, "a.txt"), "goodbye\n", "utf8");

  const result = await gitDiff(dir);
  assert.match(result.text, /-hello/);
  assert.match(result.text, /\+goodbye/);
});

test("does not show a change that's already staged (git_diff is unstaged-only)", async (t) => {
  const dir = await makeFixture({ "a.txt": "hello\n" });
  await initGitRepo(dir);
  t.after(() => cleanupFixture(dir));

  await fs.writeFile(path.join(dir, "a.txt"), "goodbye\n", "utf8");
  await execFile("git", ["add", "a.txt"], { cwd: dir });

  const result = await gitDiff(dir);
  assert.equal(result.text, "");
});

test("scopes the diff to a path", async (t) => {
  const dir = await makeFixture({ "a.txt": "hello\n", "sub/b.txt": "hello\n" });
  await initGitRepo(dir);
  t.after(() => cleanupFixture(dir));

  await fs.writeFile(path.join(dir, "a.txt"), "changed\n", "utf8");
  await fs.writeFile(path.join(dir, "sub/b.txt"), "changed\n", "utf8");

  const result = await gitDiff(dir, { path: "sub" });
  assert.match(result.text, /b\.txt/);
  assert.doesNotMatch(result.text, /a\.txt/);
});

test("truncates a large diff", async (t) => {
  const original = Array.from({ length: 3000 }, (_, i) => `line ${i}`).join("\n") + "\n";
  const dir = await makeFixture({ "big.txt": original });
  await initGitRepo(dir);
  t.after(() => cleanupFixture(dir));

  const changed = Array.from({ length: 3000 }, (_, i) => `line ${i} changed`).join("\n") + "\n";
  await fs.writeFile(path.join(dir, "big.txt"), changed, "utf8");

  const result = await gitDiff(dir);
  assert.equal(result.truncated, true);
});

test("rejects when the directory is not a git repository", async (t) => {
  const dir = await makeFixture({ "a.txt": "" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(() => gitDiff(dir), /git diff failed/);
});

test("omits a sandbox-restricted file's diff, even though git itself reports it", async (t) => {
  // The exact scenario that previously leaked: a .env tracked in git (with placeholder content)
  // gets a real secret written into it, and an ordinary unscoped git_diff call — the tool's
  // documented default — used to show the full +/- content unfiltered.
  const dir = await makeFixture({ "a.txt": "hello\n", ".env": "API_KEY=placeholder\n" });
  await initGitRepo(dir);
  t.after(() => cleanupFixture(dir));

  await fs.writeFile(path.join(dir, "a.txt"), "goodbye\n", "utf8");
  await fs.writeFile(path.join(dir, ".env"), "API_KEY=sk-live-secret\n", "utf8");

  const result = await gitDiff(dir);
  assert.match(result.text, /a\.txt/);
  assert.match(result.text, /-hello/);
  assert.match(result.text, /\+goodbye/);
  assert.doesNotMatch(result.text, /\.env/);
  assert.doesNotMatch(result.text, /placeholder/);
  assert.doesNotMatch(result.text, /sk-live-secret/);
});

test("omits a restricted file's diff even when explicitly scoped to it by path", async (t) => {
  const dir = await makeFixture({ ".env": "API_KEY=placeholder\n" });
  await initGitRepo(dir);
  t.after(() => cleanupFixture(dir));

  await fs.writeFile(path.join(dir, ".env"), "API_KEY=sk-live-secret\n", "utf8");

  const result = await gitDiff(dir, { path: ".env" });
  assert.equal(result.text, "");
});

test("still shows an unrestricted file's diff normally when a restricted one is also changed", async (t) => {
  const dir = await makeFixture({ "a.txt": "hello\n", "b.txt": "hello\n", ".env": "SECRET=1\n" });
  await initGitRepo(dir);
  t.after(() => cleanupFixture(dir));

  await fs.writeFile(path.join(dir, "a.txt"), "changed-a\n", "utf8");
  await fs.writeFile(path.join(dir, "b.txt"), "changed-b\n", "utf8");
  await fs.writeFile(path.join(dir, ".env"), "SECRET=2\n", "utf8");

  const result = await gitDiff(dir);
  assert.match(result.text, /changed-a/);
  assert.match(result.text, /changed-b/);
  assert.doesNotMatch(result.text, /SECRET/);
});

test("rejects when the signal is already aborted", async (t) => {
  const dir = await makeFixture({ "a.txt": "hello\n" });
  await initGitRepo(dir);
  t.after(() => cleanupFixture(dir));

  await fs.writeFile(path.join(dir, "a.txt"), "changed\n", "utf8");

  const ac = new AbortController();
  ac.abort();
  await assert.rejects(() => gitDiff(dir, { signal: ac.signal }));
});
