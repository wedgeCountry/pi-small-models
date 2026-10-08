import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { editFile } from "../src/tools/edit.ts";
import { makeFixture, cleanupFixture } from "./fixtures.ts";
import { Sandbox } from "../src/sandbox/sandbox.ts";

test("replaces a unique block of text", async (t) => {
  const dir = await makeFixture({ "a.txt": "const foo = 1;\nconst bar = 2;\n" });
  t.after(() => cleanupFixture(dir));

  await editFile(new Sandbox(dir), path.join(dir, "a.txt"), "const foo = 1;", "const foo = 2;");
  const content = await fs.readFile(path.join(dir, "a.txt"), "utf8");
  assert.equal(content, "const foo = 2;\nconst bar = 2;\n");
});

test("rejects when oldText is not found", async (t) => {
  const dir = await makeFixture({ "a.txt": "hello\n" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(() => editFile(new Sandbox(dir), path.join(dir, "a.txt"), "missing", "x"));
});

test("rejects when oldText matches more than once", async (t) => {
  const dir = await makeFixture({ "a.txt": "dup\ndup\n" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(() => editFile(new Sandbox(dir), path.join(dir, "a.txt"), "dup", "x"));
});

test("rejects when oldText and newText are identical", async (t) => {
  const dir = await makeFixture({ "a.txt": "same\n" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(() => editFile(new Sandbox(dir), path.join(dir, "a.txt"), "same", "same"));
});

test("rejects when the file does not exist", async (t) => {
  const dir = await makeFixture({});
  t.after(() => cleanupFixture(dir));

  await assert.rejects(() => editFile(new Sandbox(dir), path.join(dir, "missing.txt"), "a", "b"));
});

test("replaces all occurrences when allowMultipleMatches is set", async (t) => {
  const dir = await makeFixture({ "a.txt": "dup\ndup\ndup\n" });
  t.after(() => cleanupFixture(dir));

  await editFile(new Sandbox(dir), path.join(dir, "a.txt"), "dup", "x", { allowMultipleMatches: true });
  const content = await fs.readFile(path.join(dir, "a.txt"), "utf8");
  assert.equal(content, "x\nx\nx\n");
});

test("still rejects when oldText is not found and allowMultipleMatches is set", async (t) => {
  const dir = await makeFixture({ "a.txt": "hello\n" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(() => editFile(new Sandbox(dir), path.join(dir, "a.txt"), "missing", "x", { allowMultipleMatches: true }));
});

test("rejects when the signal is already aborted, without modifying the file", async (t) => {
  const dir = await makeFixture({ "a.txt": "const foo = 1;\n" });
  t.after(() => cleanupFixture(dir));

  const ac = new AbortController();
  ac.abort();
  await assert.rejects(() => editFile(new Sandbox(dir), path.join(dir, "a.txt"), "const foo = 1;", "const foo = 2;", { signal: ac.signal }));
  const content = await fs.readFile(path.join(dir, "a.txt"), "utf8");
  assert.equal(content, "const foo = 1;\n");
});

test("rejects an empty oldText instead of matching every position", async (t) => {
  const dir = await makeFixture({ "a.txt": "abc\n" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(() => editFile(new Sandbox(dir), path.join(dir, "a.txt"), "", "X"));
  const content = await fs.readFile(path.join(dir, "a.txt"), "utf8");
  assert.equal(content, "abc\n");
});

test("rejects an empty oldText even with allowMultipleMatches, without splicing between every character", async (t) => {
  const dir = await makeFixture({ "a.txt": "abc\n" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(() => editFile(new Sandbox(dir), path.join(dir, "a.txt"), "", "X", { allowMultipleMatches: true }));
  const content = await fs.readFile(path.join(dir, "a.txt"), "utf8");
  assert.equal(content, "abc\n");
});

test("matches oldText with bare LF against a CRLF file, and keeps the file CRLF", async (t) => {
  const dir = await makeFixture({ "a.txt": "const foo = 1;\r\nconst bar = 2;\r\n" });
  t.after(() => cleanupFixture(dir));

  await editFile(new Sandbox(dir), path.join(dir, "a.txt"), "const foo = 1;\nconst bar = 2;", "const foo = 10;\nconst bar = 20;");
  const content = await fs.readFile(path.join(dir, "a.txt"), "utf8");
  assert.equal(content, "const foo = 10;\r\nconst bar = 20;\r\n");
});

test("matches oldText with CRLF against a file that's actually LF, and keeps the file LF", async (t) => {
  const dir = await makeFixture({ "a.txt": "const foo = 1;\nconst bar = 2;\n" });
  t.after(() => cleanupFixture(dir));

  await editFile(new Sandbox(dir), path.join(dir, "a.txt"), "const foo = 1;\r\nconst bar = 2;", "const foo = 10;\r\nconst bar = 20;");
  const content = await fs.readFile(path.join(dir, "a.txt"), "utf8");
  assert.equal(content, "const foo = 10;\nconst bar = 20;\n");
});

test("serializes concurrent edits to different parts of the same file so neither is lost", async (t) => {
  const dir = await makeFixture({ "a.txt": "foo\nbar\n" });
  t.after(() => cleanupFixture(dir));
  const file = path.join(dir, "a.txt");

  // Without serialization, both calls would read the original "foo\nbar\n" before either
  // writes, and whichever write lands last would silently discard the other call's change.
  await Promise.all([editFile(new Sandbox(dir), file, "foo", "FOO"), editFile(new Sandbox(dir), file, "bar", "BAR")]);

  const content = await fs.readFile(file, "utf8");
  assert.equal(content, "FOO\nBAR\n");
});

test("refuses to edit a file inside .git", async (t) => {
  const dir = await makeFixture({ ".git/HEAD": "ref: refs/heads/main", ".git/config": "[core]" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(
    () => editFile(new Sandbox(dir), path.join(dir, ".git", "HEAD"), "ref: refs/heads/main", "ref: refs/heads/dev"),
    /restricted by the sandbox/
  );
});

test("refuses to edit a nested .git file", async (t) => {
  const dir = await makeFixture({ "packages/api/.git/HEAD": "ref: refs/heads/main" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(
    () => editFile(new Sandbox(dir), path.join(dir, "packages", "api", ".git", "HEAD"), "ref: refs/heads/main", "ref: refs/heads/dev"),
    /restricted by the sandbox/
  );
});
