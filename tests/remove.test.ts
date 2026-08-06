import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { removePath } from "../src/tools/remove.ts";
import { editFile } from "../src/tools/edit.ts";
import { makeFixture, cleanupFixture } from "./fixtures.ts";

test("removes a file", async (t) => {
  const dir = await makeFixture({ "a.txt": "" });
  t.after(() => cleanupFixture(dir));

  await removePath(path.join(dir, "a.txt"));
  await assert.rejects(() => fs.stat(path.join(dir, "a.txt")));
});

test("rejects removing a directory without recursive", async (t) => {
  const dir = await makeFixture({ "sub/a.txt": "" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(() => removePath(path.join(dir, "sub")));
  const stat = await fs.stat(path.join(dir, "sub"));
  assert.ok(stat.isDirectory());
});

test("removes a directory and its contents when recursive is set", async (t) => {
  const dir = await makeFixture({ "sub/a.txt": "", "sub/nested/b.txt": "" });
  t.after(() => cleanupFixture(dir));

  await removePath(path.join(dir, "sub"), { recursive: true });
  await assert.rejects(() => fs.stat(path.join(dir, "sub")));
});

test("rejects when the path does not exist", async (t) => {
  const dir = await makeFixture({});
  t.after(() => cleanupFixture(dir));

  await assert.rejects(() => removePath(path.join(dir, "missing.txt")));
});

test("rejects when the signal is already aborted, without removing anything", async (t) => {
  const dir = await makeFixture({ "a.txt": "" });
  t.after(() => cleanupFixture(dir));

  const ac = new AbortController();
  ac.abort();
  await assert.rejects(() => removePath(path.join(dir, "a.txt"), { signal: ac.signal }));
  const stat = await fs.stat(path.join(dir, "a.txt"));
  assert.ok(stat.isFile());
});

test("aborts a recursive removal in flight via signal, leaving it intact", async (t) => {
  const dir = await makeFixture({ "sub/a.txt": "", "sub/nested/b.txt": "" });
  t.after(() => cleanupFixture(dir));

  const ac = new AbortController();
  const promise = removePath(path.join(dir, "sub"), { recursive: true, signal: ac.signal });
  ac.abort();
  await assert.rejects(() => promise);
  const stat = await fs.stat(path.join(dir, "sub"));
  assert.ok(stat.isDirectory());
});

test("refuses to remove the project root when the target matches projectRoot", async (t) => {
  const dir = await makeFixture({ "a.txt": "" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(
    () => removePath(dir, { recursive: true, projectRoot: dir }),
    /Refusing to remove the project root/
  );
  const stat = await fs.stat(dir);
  assert.ok(stat.isDirectory());
  const child = await fs.stat(path.join(dir, "a.txt"));
  assert.ok(child.isFile());
});

test("refuses to remove the project root even without recursive set", async (t) => {
  const dir = await makeFixture({});
  t.after(() => cleanupFixture(dir));

  await assert.rejects(
    () => removePath(dir, { projectRoot: dir }),
    /Refusing to remove the project root/
  );
  const stat = await fs.stat(dir);
  assert.ok(stat.isDirectory());
});

test("refuses to remove the project root given an unnormalized (trailing-slash) path", async (t) => {
  const dir = await makeFixture({});
  t.after(() => cleanupFixture(dir));

  await assert.rejects(
    () => removePath(dir + path.sep, { recursive: true, projectRoot: dir }),
    /Refusing to remove the project root/
  );
  const stat = await fs.stat(dir);
  assert.ok(stat.isDirectory());
});

test("still allows removing a path inside the project root when projectRoot is set", async (t) => {
  const dir = await makeFixture({ "a.txt": "" });
  t.after(() => cleanupFixture(dir));

  await removePath(path.join(dir, "a.txt"), { projectRoot: dir });
  await assert.rejects(() => fs.stat(path.join(dir, "a.txt")));
});

test("serializes a remove against a concurrent edit on the same file, without resurrecting a deleted file", async (t) => {
  const dir = await makeFixture({ "a.txt": "content\n" });
  t.after(() => cleanupFixture(dir));
  const file = path.join(dir, "a.txt");

  // Two valid outcomes depending on which call goes first: remove-then-edit leaves the edit
  // rejecting (nothing to read), edit-then-remove leaves the edit's result deleted right after.
  // Either way the file must not exist afterward. Without serialization, edit could read the
  // file before remove deletes it and then write its result back *after* the delete, resurrecting
  // a file remove was supposed to have removed for good.
  await Promise.allSettled([removePath(file), editFile(file, "content", "changed")]);

  await assert.rejects(() => fs.stat(file));
});
