import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { writeFile } from "../tools/write.ts";
import { editFile } from "../tools/edit.ts";
import { makeFixture, cleanupFixture } from "./fixtures.ts";

test("creates a new file with the given content", async (t) => {
  const dir = await makeFixture({});
  t.after(() => cleanupFixture(dir));

  await writeFile(path.join(dir, "a.txt"), "hello\n");
  const content = await fs.readFile(path.join(dir, "a.txt"), "utf8");
  assert.equal(content, "hello\n");
});

test("overwrites an existing file", async (t) => {
  const dir = await makeFixture({ "a.txt": "old\n" });
  t.after(() => cleanupFixture(dir));

  await writeFile(path.join(dir, "a.txt"), "new\n");
  const content = await fs.readFile(path.join(dir, "a.txt"), "utf8");
  assert.equal(content, "new\n");
});

test("creates missing parent directories", async (t) => {
  const dir = await makeFixture({});
  t.after(() => cleanupFixture(dir));

  await writeFile(path.join(dir, "a", "b", "c.txt"), "hello\n");
  const content = await fs.readFile(path.join(dir, "a", "b", "c.txt"), "utf8");
  assert.equal(content, "hello\n");
});

test("rejects when the signal is already aborted, without creating the file", async (t) => {
  const dir = await makeFixture({});
  t.after(() => cleanupFixture(dir));

  const ac = new AbortController();
  ac.abort();
  await assert.rejects(() => writeFile(path.join(dir, "a.txt"), "hello\n", { signal: ac.signal }));
  await assert.rejects(() => fs.stat(path.join(dir, "a.txt")));
});

test("serializes against a concurrent edit on the same file so the write's content always wins", async (t) => {
  const dir = await makeFixture({ "a.txt": "orig\n" });
  t.after(() => cleanupFixture(dir));
  const file = path.join(dir, "a.txt");

  // Whichever of these runs first, the write's payload should be the final state: if write runs
  // first the edit's oldText ("orig") is gone and it rejects; if edit runs first its result gets
  // wholesale replaced by the write right after. Without serialization the two could interleave
  // (edit reads "orig" before the write lands, then writes "EDITED" back *after* the write
  // finishes), silently discarding the write.
  await Promise.allSettled([writeFile(file, "replaced\n"), editFile(file, "orig", "EDITED")]);

  const content = await fs.readFile(file, "utf8");
  assert.equal(content, "replaced\n");
});

test("refuses to write to a file inside .git", async (t) => {
  const dir = await makeFixture({ ".git/HEAD": "ref: refs/heads/main" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(
    () => writeFile(path.join(dir, ".git", "config"), "[core]", { sandboxRoot: dir, sandboxMode: "edit" }),
    /restricted in edit mode/
  );
});

test("refuses to write to a new file inside .git", async (t) => {
  const dir = await makeFixture({ ".git/HEAD": "ref: refs/heads/main" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(
    () => writeFile(path.join(dir, ".git", "newfile"), "content", { sandboxRoot: dir, sandboxMode: "edit" }),
    /restricted in edit mode/
  );
});

test("refuses to write to a nested .git directory", async (t) => {
  const dir = await makeFixture({ "packages/api/.git/HEAD": "ref: refs/heads/main" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(
    () => writeFile(path.join(dir, "packages", "api", ".git", "config"), "[core]", { sandboxRoot: dir, sandboxMode: "edit" }),
    /restricted in edit mode/
  );
});
