import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { gitStatus } from "../tools/git_status.ts";
import { makeFixture, cleanupFixture, initGitRepo } from "./fixtures.ts";

const execFile = promisify(execFileCb);

test("reports a clean repo with no entries and a branch name", async (t) => {
  const dir = await makeFixture({ "a.txt": "hello\n" });
  await initGitRepo(dir);
  t.after(() => cleanupFixture(dir));

  const result = await gitStatus(dir);
  assert.deepEqual(result.entries, []);
  assert.equal(typeof result.branch, "string");
  assert.equal(result.ahead, 0);
  assert.equal(result.behind, 0);
});

test("reports modified and untracked files", async (t) => {
  const dir = await makeFixture({ "a.txt": "hello\n" });
  await initGitRepo(dir);
  t.after(() => cleanupFixture(dir));

  await fs.writeFile(path.join(dir, "a.txt"), "changed\n", "utf8");
  await fs.writeFile(path.join(dir, "b.txt"), "new\n", "utf8");

  const result = await gitStatus(dir);
  const byPath = Object.fromEntries(result.entries.map((e) => [e.path, e]));
  assert.equal(byPath["a.txt"]!.worktreeStatus, "M");
  assert.equal(byPath["b.txt"]!.indexStatus, "?");
  assert.equal(byPath["b.txt"]!.worktreeStatus, "?");
});

test("reports staged files separately from unstaged ones", async (t) => {
  const dir = await makeFixture({ "a.txt": "hello\n", "b.txt": "hello\n" });
  await initGitRepo(dir);
  t.after(() => cleanupFixture(dir));

  await fs.writeFile(path.join(dir, "a.txt"), "staged change\n", "utf8");
  await execFile("git", ["add", "a.txt"], { cwd: dir });
  await fs.writeFile(path.join(dir, "b.txt"), "unstaged change\n", "utf8");

  const result = await gitStatus(dir);
  const byPath = Object.fromEntries(result.entries.map((e) => [e.path, e]));
  assert.equal(byPath["a.txt"]!.indexStatus, "M");
  assert.equal(byPath["a.txt"]!.worktreeStatus, " ");
  assert.equal(byPath["b.txt"]!.indexStatus, " ");
  assert.equal(byPath["b.txt"]!.worktreeStatus, "M");
});

test("scopes status to a path", async (t) => {
  const dir = await makeFixture({ "a.txt": "hello\n", "sub/b.txt": "hello\n" });
  await initGitRepo(dir);
  t.after(() => cleanupFixture(dir));

  await fs.writeFile(path.join(dir, "a.txt"), "changed\n", "utf8");
  await fs.writeFile(path.join(dir, "sub/b.txt"), "changed\n", "utf8");

  const result = await gitStatus(dir, { path: "sub" });
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0]!.path, "sub/b.txt");
});

test("rejects when the directory is not a git repository", async (t) => {
  const dir = await makeFixture({ "a.txt": "" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(() => gitStatus(dir), /git status failed/);
});

test("rejects when the signal is already aborted", async (t) => {
  const dir = await makeFixture({ "a.txt": "hello\n" });
  await initGitRepo(dir);
  t.after(() => cleanupFixture(dir));

  const ac = new AbortController();
  ac.abort();
  await assert.rejects(() => gitStatus(dir, { signal: ac.signal }));
});
