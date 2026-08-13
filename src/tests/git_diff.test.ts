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

test("only shows staged changes when staged is set", async (t) => {
  const dir = await makeFixture({ "a.txt": "hello\n" });
  await initGitRepo(dir);
  t.after(() => cleanupFixture(dir));

  await fs.writeFile(path.join(dir, "a.txt"), "goodbye\n", "utf8");
  await execFile("git", ["add", "a.txt"], { cwd: dir });

  const unstaged = await gitDiff(dir);
  assert.equal(unstaged.text, "");

  const staged = await gitDiff(dir, { staged: true });
  assert.match(staged.text, /\+goodbye/);
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

test("rejects when the signal is already aborted", async (t) => {
  const dir = await makeFixture({ "a.txt": "hello\n" });
  await initGitRepo(dir);
  t.after(() => cleanupFixture(dir));

  await fs.writeFile(path.join(dir, "a.txt"), "changed\n", "utf8");

  const ac = new AbortController();
  ac.abort();
  await assert.rejects(() => gitDiff(dir, { signal: ac.signal }));
});
