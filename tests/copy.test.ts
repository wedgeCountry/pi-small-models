import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { copyFile } from "../src/tools/copy.ts";
import { editFile } from "../src/tools/edit.ts";
import { makeFixture, cleanupFixture } from "./fixtures.ts";

test("copies a file, leaving the original in place", async (t) => {
  const dir = await makeFixture({ "a.txt": "hello\n" });
  t.after(() => cleanupFixture(dir));

  await copyFile(path.join(dir, "a.txt"), path.join(dir, "b.txt"));

  assert.equal(await fs.readFile(path.join(dir, "a.txt"), "utf8"), "hello\n");
  assert.equal(await fs.readFile(path.join(dir, "b.txt"), "utf8"), "hello\n");
});

test("creates missing parent directories of the destination", async (t) => {
  const dir = await makeFixture({ "a.txt": "hello\n" });
  t.after(() => cleanupFixture(dir));

  await copyFile(path.join(dir, "a.txt"), path.join(dir, "sub", "nested", "b.txt"));

  assert.equal(await fs.readFile(path.join(dir, "sub", "nested", "b.txt"), "utf8"), "hello\n");
});

test("rejects copying a directory without recursive", async (t) => {
  const dir = await makeFixture({ "sub/a.txt": "" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(() => copyFile(path.join(dir, "sub"), path.join(dir, "dest")));
  await assert.rejects(() => fs.stat(path.join(dir, "dest")));
});

test("copies a directory and its contents when recursive is set", async (t) => {
  const dir = await makeFixture({ "sub/a.txt": "a", "sub/nested/b.txt": "b" });
  t.after(() => cleanupFixture(dir));

  await copyFile(path.join(dir, "sub"), path.join(dir, "dest"), { recursive: true });

  assert.equal(await fs.readFile(path.join(dir, "dest", "a.txt"), "utf8"), "a");
  assert.equal(await fs.readFile(path.join(dir, "dest", "nested", "b.txt"), "utf8"), "b");
  // Original left intact
  assert.equal(await fs.readFile(path.join(dir, "sub", "a.txt"), "utf8"), "a");
});

test("rejects when the destination already exists and overwrite is not set", async (t) => {
  const dir = await makeFixture({ "a.txt": "new", "b.txt": "old" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(() => copyFile(path.join(dir, "a.txt"), path.join(dir, "b.txt")));
  assert.equal(await fs.readFile(path.join(dir, "b.txt"), "utf8"), "old");
});

test("replaces an existing destination when overwrite is set", async (t) => {
  const dir = await makeFixture({ "a.txt": "new", "b.txt": "old" });
  t.after(() => cleanupFixture(dir));

  await copyFile(path.join(dir, "a.txt"), path.join(dir, "b.txt"), { overwrite: true });
  assert.equal(await fs.readFile(path.join(dir, "b.txt"), "utf8"), "new");
});

test("rejects when source and destination are the same path", async (t) => {
  const dir = await makeFixture({ "a.txt": "content" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(
    () => copyFile(path.join(dir, "a.txt"), path.join(dir, "a.txt")),
    /same path/
  );
});

test("rejects when the source does not exist", async (t) => {
  const dir = await makeFixture({});
  t.after(() => cleanupFixture(dir));

  await assert.rejects(() => copyFile(path.join(dir, "missing.txt"), path.join(dir, "dest.txt")));
});

test("rejects when the signal is already aborted, without copying anything", async (t) => {
  const dir = await makeFixture({ "a.txt": "content" });
  t.after(() => cleanupFixture(dir));

  const ac = new AbortController();
  ac.abort();
  await assert.rejects(() => copyFile(path.join(dir, "a.txt"), path.join(dir, "b.txt"), { signal: ac.signal }));
  await assert.rejects(() => fs.stat(path.join(dir, "b.txt")));
});

test("does not block a concurrent edit on the source file", async (t) => {
  const dir = await makeFixture({ "a.txt": "orig\n" });
  t.after(() => cleanupFixture(dir));

  await Promise.all([
    copyFile(path.join(dir, "a.txt"), path.join(dir, "b.txt")),
    editFile(path.join(dir, "a.txt"), "orig", "changed"),
  ]);

  // Both operations should have succeeded independently.
  assert.equal(await fs.readFile(path.join(dir, "a.txt"), "utf8"), "changed\n");
  await fs.stat(path.join(dir, "b.txt"));
});

test("refuses to copy a file inside .git", async (t) => {
  const dir = await makeFixture({ ".git/HEAD": "ref: refs/heads/main" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(
    () =>
      copyFile(path.join(dir, ".git", "HEAD"), path.join(dir, "copy.txt"), {
        sandboxRoot: dir,
      }),
    /restricted in read mode/
  );
});

test("refuses to copy into a destination inside .git", async (t) => {
  const dir = await makeFixture({ "a.txt": "content", ".git/HEAD": "ref: refs/heads/main" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(
    () =>
      copyFile(path.join(dir, "a.txt"), path.join(dir, ".git", "a.txt"), {
        sandboxRoot: dir,
      }),
    /restricted in edit mode/
  );
});
