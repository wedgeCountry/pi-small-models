import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { readFile, getExtension, registerReadTool } from "../src/tools/read.ts";
import { makeFixture, cleanupFixture } from "./fixtures.ts";
import { Sandbox } from "../src/sandbox/sandbox.ts";

test("reads a whole file as 1-indexed lines", async (t) => {
  const dir = await makeFixture({ "a.txt": "line1\nline2\nline3" });
  t.after(() => cleanupFixture(dir));

  const result = await readFile(new Sandbox(dir), path.join(dir, "a.txt"));
  assert.deepEqual(result.lines, [
    { line: 1, text: "line1" },
    { line: 2, text: "line2" },
    { line: 3, text: "line3" },
  ]);
  assert.equal(result.totalLines, 3);
  assert.equal(result.truncated, false);
});

test("honors offset", async (t) => {
  const dir = await makeFixture({ "a.txt": "line1\nline2\nline3" });
  t.after(() => cleanupFixture(dir));

  const result = await readFile(new Sandbox(dir), path.join(dir, "a.txt"), { offset: 2 });
  assert.deepEqual(result.lines, [
    { line: 2, text: "line2" },
    { line: 3, text: "line3" },
  ]);
  assert.equal(result.truncated, false);
});

test("honors limit and reports truncation with a continuation offset", async (t) => {
  const dir = await makeFixture({ "a.txt": "line1\nline2\nline3" });
  t.after(() => cleanupFixture(dir));

  const result = await readFile(new Sandbox(dir), path.join(dir, "a.txt"), { limit: 2 });
  assert.deepEqual(result.lines, [
    { line: 1, text: "line1" },
    { line: 2, text: "line2" },
  ]);
  assert.equal(result.totalLines, 3);
  assert.equal(result.truncated, true);
});

test("combines offset and limit", async (t) => {
  const dir = await makeFixture({ "a.txt": "line1\nline2\nline3\nline4" });
  t.after(() => cleanupFixture(dir));

  const result = await readFile(new Sandbox(dir), path.join(dir, "a.txt"), { offset: 2, limit: 2 });
  assert.deepEqual(result.lines, [
    { line: 2, text: "line2" },
    { line: 3, text: "line3" },
  ]);
  assert.equal(result.truncated, true);
});

test("is not truncated when limit reaches exactly the end of the file", async (t) => {
  const dir = await makeFixture({ "a.txt": "line1\nline2\nline3" });
  t.after(() => cleanupFixture(dir));

  const result = await readFile(new Sandbox(dir), path.join(dir, "a.txt"), { limit: 3 });
  assert.equal(result.lines.length, 3);
  assert.equal(result.truncated, false);
});

test("splits lines the same way insert does, so line numbers agree across tools", async (t) => {
  const dir = await makeFixture({ "a.txt": "line1\r\nline2\r\nline3" });
  t.after(() => cleanupFixture(dir));

  const result = await readFile(new Sandbox(dir), path.join(dir, "a.txt"));
  assert.deepEqual(
    result.lines.map((l) => l.text),
    ["line1", "line2", "line3"]
  );
});

test("caps output at DEFAULT_MAX_LINES lines even without an explicit limit", async (t) => {
  const lines = Array.from({ length: 2005 }, (_, i) => `line${i + 1}`);
  const dir = await makeFixture({ "a.txt": lines.join("\n") });
  t.after(() => cleanupFixture(dir));

  const result = await readFile(new Sandbox(dir), path.join(dir, "a.txt"));
  assert.equal(result.lines.length, 2000);
  assert.equal(result.totalLines, 2005);
  assert.equal(result.truncated, true);
});

test("rejects an offset beyond the end of the file", async (t) => {
  const dir = await makeFixture({ "a.txt": "line1\nline2" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(() => readFile(new Sandbox(dir), path.join(dir, "a.txt"), { offset: 3 }));
});

test("rejects a non-positive offset", async (t) => {
  const dir = await makeFixture({ "a.txt": "line1" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(() => readFile(new Sandbox(dir), path.join(dir, "a.txt"), { offset: 0 }));
});

test("rejects a non-positive limit", async (t) => {
  const dir = await makeFixture({ "a.txt": "line1" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(() => readFile(new Sandbox(dir), path.join(dir, "a.txt"), { limit: 0 }));
});

test("rejects when the file does not exist", async (t) => {
  const dir = await makeFixture({});
  t.after(() => cleanupFixture(dir));

  await assert.rejects(() => readFile(new Sandbox(dir), path.join(dir, "missing.txt")));
});

test("rejects when the signal is already aborted", async (t) => {
  const dir = await makeFixture({ "a.txt": "line1" });
  t.after(() => cleanupFixture(dir));

  const ac = new AbortController();
  ac.abort();
  await assert.rejects(() => readFile(new Sandbox(dir), path.join(dir, "a.txt"), { signal: ac.signal }));
});

test("uncapped (internal option) returns every line past the 2000-line cap", async (t) => {
  const dir = await makeFixture({ "big.txt": Array.from({ length: 2500 }, (_, i) => `l${i}`).join("\n") });
  t.after(() => cleanupFixture(dir));

  const capped = await readFile(new Sandbox(dir), path.join(dir, "big.txt"));
  assert.equal(capped.lines.length, 2000);
  const full = await readFile(new Sandbox(dir), path.join(dir, "big.txt"), { uncapped: true });
  assert.equal(full.lines.length, 2500);
  assert.equal(full.truncated, false);
});

test("readFile resolves the path through the sandbox before reading", async (t) => {
  const dir = await makeFixture({ "a.txt": "hello", ".env": "SECRET=1" });
  t.after(() => cleanupFixture(dir));

  const ok = await readFile(new Sandbox(dir), "a.txt");
  assert.deepEqual(ok.lines, [{ line: 1, text: "hello" }]);
  await assert.rejects(readFile(new Sandbox(dir), "../outside.txt"), /outside the project root/);
  await assert.rejects(readFile(new Sandbox(dir), ".env"), /restricted by the sandbox/);
});

test("strips a UTF-8 BOM", async (t) => {
  const dir = await makeFixture({ "bom.txt": Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("héllo")]) });
  t.after(() => cleanupFixture(dir));

  const result = await readFile(new Sandbox(dir), path.join(dir, "bom.txt"));
  assert.deepEqual(result.lines, [{ line: 1, text: "héllo" }]);
});

test("decodes UTF-16LE with BOM", async (t) => {
  const dir = await makeFixture({ "u16le.txt": Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("héllo", "utf16le")]) });
  t.after(() => cleanupFixture(dir));

  const result = await readFile(new Sandbox(dir), path.join(dir, "u16le.txt"));
  assert.deepEqual(result.lines, [{ line: 1, text: "héllo" }]);
});

test("decodes UTF-16BE with BOM", async (t) => {
  const dir = await makeFixture({ "u16be.txt": Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from("héllo", "utf16le").swap16()]) });
  t.after(() => cleanupFixture(dir));

  const result = await readFile(new Sandbox(dir), path.join(dir, "u16be.txt"));
  assert.deepEqual(result.lines, [{ line: 1, text: "héllo" }]);
});

test("rejects binary files containing NUL bytes", async (t) => {
  const dir = await makeFixture({ "bin.dat": Buffer.from([0x4d, 0x5a, 0x00, 0x01, 0x02]) });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(
    readFile(new Sandbox(dir), path.join(dir, "bin.dat")),
    /binary file/,
  );
});

test("getExtension handles plain, multi-dot, dotfile, and case variants", () => {
  assert.equal(getExtension("a.txt"), ".txt");
  assert.equal(getExtension("archive.tar.gz"), ".gz");
  assert.equal(getExtension("noext"), "");
  assert.equal(getExtension(".gitignore"), ".gitignore");
  assert.equal(getExtension("IMG.PNG"), ".png");
});

test("totalLines counts a trailing newline as a line terminator, not an extra line", async (t) => {
  const dir = await makeFixture({ "a.txt": "line1\nline2\nline3\n" });
  t.after(() => cleanupFixture(dir));

  const result = await readFile(new Sandbox(dir), path.join(dir, "a.txt"));
  assert.equal(result.totalLines, 4);
  assert.equal(result.truncated, false);
});

test("totalLines counts a lone trailing newline as an empty final line", async (t) => {
  const dir = await makeFixture({ "a.txt": "\n" });
  t.after(() => cleanupFixture(dir));

  const result = await readFile(new Sandbox(dir), path.join(dir, "a.txt"));
  assert.equal(result.totalLines, 2);
  assert.deepEqual(result.lines, [
    { line: 1, text: "" },
    { line: 2, text: "" },
  ]);
});

test("throws when the offset is past the end of the file", async (t) => {
  const dir = await makeFixture({ "a.txt": "line1\nline2" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(
    readFile(new Sandbox(dir), path.join(dir, "a.txt"), { offset: 3 }),
    /beyond end of file \(2 line/,
  );
});

test("rejects an offset far beyond the end of the file", async (t) => {
  const dir = await makeFixture({ "a.txt": "line1\nline2" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(
    readFile(new Sandbox(dir), path.join(dir, "a.txt"), { offset: 99 }),
    /beyond end of file/,
  );
});

test("does not flag a large text file as binary", async (t) => {
  const dir = await makeFixture({ "big.txt": "line\n".repeat(20 * 1024) + "payload" });
  t.after(() => cleanupFixture(dir));

  const result = await readFile(new Sandbox(dir), path.join(dir, "big.txt"), { offset: 1, limit: 1 });
  assert.equal(result.lines[0]!.text, "line");
});

test("throws for a file that starts as text but contains a NUL byte", async (t) => {
  const dir = await makeFixture({ "sneaky.txt": Buffer.concat([Buffer.from("hello\nworld\n"), Buffer.from([0x00, 0x01])]) });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(
    readFile(new Sandbox(dir), path.join(dir, "sneaky.txt")),
    /binary file/,
  );
});

test("does not flag a file with U+FEFF mid-content (not a BOM, not a NUL)", async (t) => {
  const dir = await makeFixture({ "zwsp.txt": "before\uFEFFafter" });
  t.after(() => cleanupFixture(dir));

  const result = await readFile(new Sandbox(dir), path.join(dir, "zwsp.txt"));
  assert.deepEqual(result.lines, [{ line: 1, text: "before\uFEFFafter" }]);
});

test("uncapped reads bypass the byte cap entirely", async (t) => {
  const lineCount = 12801;
  const dir = await makeFixture({ "big.txt": "aaa\n".repeat(lineCount) });
  t.after(() => cleanupFixture(dir));

  const result = await readFile(new Sandbox(dir), path.join(dir, "big.txt"), { uncapped: true });
  assert.equal(result.lines.length, lineCount + 1);
  assert.equal(result.truncated, false);
});
