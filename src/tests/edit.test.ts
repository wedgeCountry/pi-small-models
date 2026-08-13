import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { editFile, editFileMulti } from "../tools/edit.ts";
import { makeFixture, cleanupFixture } from "./fixtures.ts";

test("replaces a unique block of text", async (t) => {
  const dir = await makeFixture({ "a.txt": "const foo = 1;\nconst bar = 2;\n" });
  t.after(() => cleanupFixture(dir));

  await editFile(path.join(dir, "a.txt"), "const foo = 1;", "const foo = 2;");
  const content = await fs.readFile(path.join(dir, "a.txt"), "utf8");
  assert.equal(content, "const foo = 2;\nconst bar = 2;\n");
});

test("rejects when oldText is not found", async (t) => {
  const dir = await makeFixture({ "a.txt": "hello\n" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(() => editFile(path.join(dir, "a.txt"), "missing", "x"));
});

test("rejects when oldText matches more than once", async (t) => {
  const dir = await makeFixture({ "a.txt": "dup\ndup\n" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(() => editFile(path.join(dir, "a.txt"), "dup", "x"));
});

test("rejects when oldText and newText are identical", async (t) => {
  const dir = await makeFixture({ "a.txt": "same\n" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(() => editFile(path.join(dir, "a.txt"), "same", "same"));
});

test("rejects when the file does not exist", async (t) => {
  const dir = await makeFixture({});
  t.after(() => cleanupFixture(dir));

  await assert.rejects(() => editFile(path.join(dir, "missing.txt"), "a", "b"));
});

test("replaces all occurrences when allowMultipleMatches is set", async (t) => {
  const dir = await makeFixture({ "a.txt": "dup\ndup\ndup\n" });
  t.after(() => cleanupFixture(dir));

  await editFile(path.join(dir, "a.txt"), "dup", "x", { allowMultipleMatches: true });
  const content = await fs.readFile(path.join(dir, "a.txt"), "utf8");
  assert.equal(content, "x\nx\nx\n");
});

test("still rejects when oldText is not found and allowMultipleMatches is set", async (t) => {
  const dir = await makeFixture({ "a.txt": "hello\n" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(() => editFile(path.join(dir, "a.txt"), "missing", "x", { allowMultipleMatches: true }));
});

test("rejects when the signal is already aborted, without modifying the file", async (t) => {
  const dir = await makeFixture({ "a.txt": "const foo = 1;\n" });
  t.after(() => cleanupFixture(dir));

  const ac = new AbortController();
  ac.abort();
  await assert.rejects(() => editFile(path.join(dir, "a.txt"), "const foo = 1;", "const foo = 2;", { signal: ac.signal }));
  const content = await fs.readFile(path.join(dir, "a.txt"), "utf8");
  assert.equal(content, "const foo = 1;\n");
});

test("rejects an empty oldText instead of matching every position", async (t) => {
  const dir = await makeFixture({ "a.txt": "abc\n" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(() => editFile(path.join(dir, "a.txt"), "", "X"));
  const content = await fs.readFile(path.join(dir, "a.txt"), "utf8");
  assert.equal(content, "abc\n");
});

test("rejects an empty oldText even with allowMultipleMatches, without splicing between every character", async (t) => {
  const dir = await makeFixture({ "a.txt": "abc\n" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(() => editFile(path.join(dir, "a.txt"), "", "X", { allowMultipleMatches: true }));
  const content = await fs.readFile(path.join(dir, "a.txt"), "utf8");
  assert.equal(content, "abc\n");
});

test("editFileMulti applies several edits atomically in one call", async (t) => {
  const dir = await makeFixture({ "a.txt": "const foo = 1;\nconst bar = 2;\n" });
  t.after(() => cleanupFixture(dir));

  await editFileMulti(path.join(dir, "a.txt"), [
    { oldText: "const foo = 1;", newText: "const foo = 10;" },
    { oldText: "const bar = 2;", newText: "const bar = 20;" },
  ]);
  const content = await fs.readFile(path.join(dir, "a.txt"), "utf8");
  assert.equal(content, "const foo = 10;\nconst bar = 20;\n");
});

test("editFileMulti accepts a single-item edits array", async (t) => {
  const dir = await makeFixture({ "a.txt": "const foo = 1;\nconst bar = 2;\n" });
  t.after(() => cleanupFixture(dir));

  await editFileMulti(path.join(dir, "a.txt"), [{ oldText: "const foo = 1;", newText: "const foo = 10;" }]);
  const content = await fs.readFile(path.join(dir, "a.txt"), "utf8");
  assert.equal(content, "const foo = 10;\nconst bar = 2;\n");
});

test("editFileMulti applies later edits against the result of earlier ones", async (t) => {
  const dir = await makeFixture({ "a.txt": "one\ntwo\nthree\n" });
  t.after(() => cleanupFixture(dir));

  // The second edit's oldText only exists in the file *after* the first edit runs.
  await editFileMulti(path.join(dir, "a.txt"), [
    { oldText: "one\ntwo", newText: "uno\ndos" },
    { oldText: "uno\ndos\nthree", newText: "uno\ndos\ntres" },
  ]);
  const content = await fs.readFile(path.join(dir, "a.txt"), "utf8");
  assert.equal(content, "uno\ndos\ntres\n");
});

test("editFileMulti leaves the file untouched if a later edit fails", async (t) => {
  const dir = await makeFixture({ "a.txt": "const foo = 1;\nconst bar = 2;\n" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(() =>
    editFileMulti(path.join(dir, "a.txt"), [
      { oldText: "const foo = 1;", newText: "const foo = 10;" },
      { oldText: "not in the file", newText: "x" },
    ])
  );
  const content = await fs.readFile(path.join(dir, "a.txt"), "utf8");
  assert.equal(content, "const foo = 1;\nconst bar = 2;\n");
});

test("editFileMulti rejects an empty edits array", async (t) => {
  const dir = await makeFixture({ "a.txt": "hello\n" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(() => editFileMulti(path.join(dir, "a.txt"), []));
});

test("editFileMulti rejects when one edit's oldText is not unique", async (t) => {
  const dir = await makeFixture({ "a.txt": "dup\ndup\n" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(() => editFileMulti(path.join(dir, "a.txt"), [{ oldText: "dup", newText: "x" }]));
});

test("editFileMulti honors per-edit allowMultipleMatches", async (t) => {
  const dir = await makeFixture({ "a.txt": "dup\ndup\nother\n" });
  t.after(() => cleanupFixture(dir));

  await editFileMulti(path.join(dir, "a.txt"), [
    { oldText: "dup", newText: "x", allowMultipleMatches: true },
    { oldText: "other", newText: "y" },
  ]);
  const content = await fs.readFile(path.join(dir, "a.txt"), "utf8");
  assert.equal(content, "x\nx\ny\n");
});

test("matches oldText with bare LF against a CRLF file, and keeps the file CRLF", async (t) => {
  const dir = await makeFixture({ "a.txt": "const foo = 1;\r\nconst bar = 2;\r\n" });
  t.after(() => cleanupFixture(dir));

  await editFile(path.join(dir, "a.txt"), "const foo = 1;\nconst bar = 2;", "const foo = 10;\nconst bar = 20;");
  const content = await fs.readFile(path.join(dir, "a.txt"), "utf8");
  assert.equal(content, "const foo = 10;\r\nconst bar = 20;\r\n");
});

test("matches oldText with CRLF against a file that's actually LF, and keeps the file LF", async (t) => {
  const dir = await makeFixture({ "a.txt": "const foo = 1;\nconst bar = 2;\n" });
  t.after(() => cleanupFixture(dir));

  await editFile(path.join(dir, "a.txt"), "const foo = 1;\r\nconst bar = 2;", "const foo = 10;\r\nconst bar = 20;");
  const content = await fs.readFile(path.join(dir, "a.txt"), "utf8");
  assert.equal(content, "const foo = 10;\nconst bar = 20;\n");
});

test("editFileMulti matches bare-LF oldText against a CRLF file across several edits", async (t) => {
  const dir = await makeFixture({ "a.txt": "const foo = 1;\r\nconst bar = 2;\r\n" });
  t.after(() => cleanupFixture(dir));

  await editFileMulti(path.join(dir, "a.txt"), [
    { oldText: "const foo = 1;", newText: "const foo = 10;" },
    { oldText: "const bar = 2;", newText: "const bar = 20;" },
  ]);
  const content = await fs.readFile(path.join(dir, "a.txt"), "utf8");
  assert.equal(content, "const foo = 10;\r\nconst bar = 20;\r\n");
});

test("serializes concurrent edits to different parts of the same file so neither is lost", async (t) => {
  const dir = await makeFixture({ "a.txt": "foo\nbar\n" });
  t.after(() => cleanupFixture(dir));
  const file = path.join(dir, "a.txt");

  // Without serialization, both calls would read the original "foo\nbar\n" before either
  // writes, and whichever write lands last would silently discard the other call's change.
  await Promise.all([editFile(file, "foo", "FOO"), editFile(file, "bar", "BAR")]);

  const content = await fs.readFile(file, "utf8");
  assert.equal(content, "FOO\nBAR\n");
});
