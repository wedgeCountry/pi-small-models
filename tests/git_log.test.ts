import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { gitLog, formatGitLog } from "../src/tools/git_log.ts";
import { makeFixture, cleanupFixture, initGitRepo } from "./fixtures.ts";
import { Sandbox } from "../src/sandbox/sandbox.ts";

const execFile = promisify(execFileCb);

async function commit(dir: string, file: string, content: string, message: string) {
  await fs.mkdir(path.dirname(path.join(dir, file)), { recursive: true });
  await fs.writeFile(path.join(dir, file), content, "utf8");
  await execFile("git", ["add", "-A"], { cwd: dir });
  await execFile("git", ["commit", "-q", "-m", message], { cwd: dir });
}

test("returns the latest commit first with its changed files", async (t) => {
  const dir = await makeFixture({ "a.txt": "hello\n" });
  await initGitRepo(dir);
  t.after(() => cleanupFixture(dir));
  await commit(dir, "b.txt", "x\n", "add b");

  const { commits } = await gitLog(new Sandbox(dir), { maxCount: 1 });
  assert.equal(commits.length, 1);
  assert.equal(commits[0]!.subject, "add b");
  assert.equal(commits[0]!.author, "Test");
  assert.deepEqual(commits[0]!.files, ["b.txt"]);
  assert.match(commits[0]!.hash, /^[0-9a-f]{40}$/);
});

test("defaults to only the latest commit", async (t) => {
  const dir = await makeFixture({ "a.txt": "hello\n" });
  await initGitRepo(dir);
  t.after(() => cleanupFixture(dir));
  await commit(dir, "b.txt", "x\n", "add b");

  const { commits } = await gitLog(new Sandbox(dir));
  assert.deepEqual(commits.map((c) => c.subject), ["add b"]);
});

test("returns multiple commits newest first when maxCount allows", async (t) => {
  const dir = await makeFixture({ "a.txt": "hello\n" });
  await initGitRepo(dir);
  t.after(() => cleanupFixture(dir));
  await commit(dir, "b.txt", "x\n", "add b");

  const { commits } = await gitLog(new Sandbox(dir), { maxCount: 10 });
  assert.deepEqual(commits.map((c) => c.subject), ["add b", "initial"]);
});

test("scopes to a path", async (t) => {
  const dir = await makeFixture({ "a.txt": "hello\n" });
  await initGitRepo(dir);
  t.after(() => cleanupFixture(dir));
  await commit(dir, "sub/b.txt", "x\n", "add b");

  const { commits } = await gitLog(new Sandbox(dir), { path: "a.txt" });
  assert.deepEqual(commits.map((c) => c.subject), ["initial"]);
});

test("hides restricted files from a commit's file list", async (t) => {
  const dir = await makeFixture({ "a.txt": "hello\n" });
  await initGitRepo(dir);
  t.after(() => cleanupFixture(dir));
  await commit(dir, ".env", "SECRET=1\n", "add env");

  const { commits } = await gitLog(new Sandbox(dir), { maxCount: 1 });
  assert.equal(commits[0]!.subject, "add env");
  assert.deepEqual(commits[0]!.files, []);
});

test("returns no commits for a repo without history", async (t) => {
  const dir = await makeFixture({});
  await execFile("git", ["init", "-q"], { cwd: dir });
  t.after(() => cleanupFixture(dir));

  const result = await gitLog(new Sandbox(dir));
  assert.deepEqual(result.commits, []);
  assert.equal(formatGitLog(result), "No commits.");
});
