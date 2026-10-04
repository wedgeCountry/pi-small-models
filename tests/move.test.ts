import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { moveFile } from "../src/tools/move.ts";
import { makeFixture, cleanupFixture } from "./fixtures.ts";

test("moves (renames) a file", async (t) => {
  const dir = await makeFixture({ "a.txt": "hello\n" });
  t.after(() => cleanupFixture(dir));

  await moveFile(path.join(dir, "a.txt"), path.join(dir, "b.txt"));

  await assert.rejects(() => fs.stat(path.join(dir, "a.txt")));
  assert.equal(await fs.readFile(path.join(dir, "b.txt"), "utf8"), "hello\n");
});

test("creates missing parent directories of the destination", async (t) => {
  const dir = await makeFixture({ "a.txt": "hello\n" });
  t.after(() => cleanupFixture(dir));

  await moveFile(path.join(dir, "a.txt"), path.join(dir, "sub", "nested", "b.txt"));

  assert.equal(await fs.readFile(path.join(dir, "sub", "nested", "b.txt"), "utf8"), "hello\n");
  await assert.rejects(() => fs.stat(path.join(dir, "a.txt")));
});

test("rejects moving a directory without recursive", async (t) => {
  const dir = await makeFixture({ "sub/a.txt": "" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(() => moveFile(path.join(dir, "sub"), path.join(dir, "dest")));
  const stat = await fs.stat(path.join(dir, "sub"));
  assert.ok(stat.isDirectory());
});

test("moves a directory and its contents when recursive is set", async (t) => {
  const dir = await makeFixture({ "sub/a.txt": "a", "sub/nested/b.txt": "b" });
  t.after(() => cleanupFixture(dir));

  await moveFile(path.join(dir, "sub"), path.join(dir, "dest"), { recursive: true });

  assert.equal(await fs.readFile(path.join(dir, "dest", "a.txt"), "utf8"), "a");
  assert.equal(await fs.readFile(path.join(dir, "dest", "nested", "b.txt"), "utf8"), "b");
  await assert.rejects(() => fs.stat(path.join(dir, "sub")));
});

test("rejects when the destination already exists and overwrite is not set", async (t) => {
  const dir = await makeFixture({ "a.txt": "new", "b.txt": "old" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(() => moveFile(path.join(dir, "a.txt"), path.join(dir, "b.txt")));
  assert.equal(await fs.readFile(path.join(dir, "b.txt"), "utf8"), "old");
  assert.equal(await fs.readFile(path.join(dir, "a.txt"), "utf8"), "new");
});

test("replaces an existing destination file when overwrite is set", async (t) => {
  const dir = await makeFixture({ "a.txt": "new", "b.txt": "old" });
  t.after(() => cleanupFixture(dir));

  await moveFile(path.join(dir, "a.txt"), path.join(dir, "b.txt"), { overwrite: true });
  assert.equal(await fs.readFile(path.join(dir, "b.txt"), "utf8"), "new");
  await assert.rejects(() => fs.stat(path.join(dir, "a.txt")));
});

test("replaces an existing destination directory when overwrite is set", async (t) => {
  const dir = await makeFixture({ "sub/a.txt": "a", "dest/stale.txt": "stale" });
  t.after(() => cleanupFixture(dir));

  await moveFile(path.join(dir, "sub"), path.join(dir, "dest"), { recursive: true, overwrite: true });

  assert.equal(await fs.readFile(path.join(dir, "dest", "a.txt"), "utf8"), "a");
  await assert.rejects(() => fs.stat(path.join(dir, "dest", "stale.txt")));
});

test("rejects when source and destination are the same path", async (t) => {
  const dir = await makeFixture({ "a.txt": "content" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(
    () => moveFile(path.join(dir, "a.txt"), path.join(dir, "a.txt")),
    /same path/
  );
  assert.equal(await fs.readFile(path.join(dir, "a.txt"), "utf8"), "content");
});

test("rejects when the source does not exist", async (t) => {
  const dir = await makeFixture({});
  t.after(() => cleanupFixture(dir));

  await assert.rejects(() => moveFile(path.join(dir, "missing.txt"), path.join(dir, "dest.txt")));
});

test("rejects when the signal is already aborted, without moving anything", async (t) => {
  const dir = await makeFixture({ "a.txt": "content" });
  t.after(() => cleanupFixture(dir));

  const ac = new AbortController();
  ac.abort();
  await assert.rejects(() => moveFile(path.join(dir, "a.txt"), path.join(dir, "b.txt"), { signal: ac.signal }));
  await fs.stat(path.join(dir, "a.txt"));
  await assert.rejects(() => fs.stat(path.join(dir, "b.txt")));
});

test("refuses to move the project root", async (t) => {
  const dir = await makeFixture({ "a.txt": "" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(
    () => moveFile(dir, path.join(path.dirname(dir), "moved"), { recursive: true, projectRoot: dir }),
    /Refusing to move the project root/
  );
  const stat = await fs.stat(dir);
  assert.ok(stat.isDirectory());
});

test("swapping two paths concurrently does not deadlock", async (t) => {
  const dir = await makeFixture({ "a.txt": "a", "b.txt": "b" });
  t.after(() => cleanupFixture(dir));

  // One call moves a -> tmp, the other (racing) targets the same pair of paths in the opposite
  // lexical pairing to exercise the lock-ordering logic; both target distinct destinations so
  // there's no actual conflict, only the same two queue keys contended in both directions.
  await Promise.all([
    moveFile(path.join(dir, "a.txt"), path.join(dir, "a2.txt")),
    moveFile(path.join(dir, "b.txt"), path.join(dir, "b2.txt")),
  ]);

  assert.equal(await fs.readFile(path.join(dir, "a2.txt"), "utf8"), "a");
  assert.equal(await fs.readFile(path.join(dir, "b2.txt"), "utf8"), "b");
});

test("refuses to move a file inside .git", async (t) => {
  const dir = await makeFixture({ ".git/HEAD": "ref: refs/heads/main" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(
    () =>
      moveFile(path.join(dir, ".git", "HEAD"), path.join(dir, "moved.txt"), {
        sandboxRoot: dir,
      }),
    /restricted in edit mode/
  );
});

test("refuses to move into a destination inside .git", async (t) => {
  const dir = await makeFixture({ "a.txt": "content", ".git/HEAD": "ref: refs/heads/main" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(
    () =>
      moveFile(path.join(dir, "a.txt"), path.join(dir, ".git", "a.txt"), {
        sandboxRoot: dir,
      }),
    /restricted in edit mode/
  );
});
