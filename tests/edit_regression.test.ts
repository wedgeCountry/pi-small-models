import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { editFile } from "../src/tools/edit.ts";
import { makeFixture, cleanupFixture } from "./fixtures.ts";
import { Sandbox } from "../src/sandbox/sandbox.ts";

// Regression tests for the bug: "edit tools sometimes accidentally cuts off the end of the file"
// These tests specifically target edge cases at the end of files

test("edit at very end of file - single character", async (t) => {
  const dir = await makeFixture({ "a.txt": "const foo = 1;" });
  t.after(() => cleanupFixture(dir));

  await editFile(new Sandbox(dir), path.join(dir, "a.txt"), "1", "2");
  const content = await fs.readFile(path.join(dir, "a.txt"), "utf8");
  assert.equal(content, "const foo = 2;");
});

test("edit at very end of file - last character is semicolon", async (t) => {
  const dir = await makeFixture({ "a.txt": "const foo = 1;" });
  t.after(() => cleanupFixture(dir));

  await editFile(new Sandbox(dir), path.join(dir, "a.txt"), ";", ":");
  const content = await fs.readFile(path.join(dir, "a.txt"), "utf8");
  assert.equal(content, "const foo = 1:");
});

test("edit at very end of file - with trailing newline", async (t) => {
  const dir = await makeFixture({ "a.txt": "const foo = 1;\n" });
  t.after(() => cleanupFixture(dir));

  await editFile(new Sandbox(dir), path.join(dir, "a.txt"), "1;\n", "2;\n");
  const content = await fs.readFile(path.join(dir, "a.txt"), "utf8");
  assert.equal(content, "const foo = 2;\n");
});

test("edit at very end of file - without trailing newline, oldText includes newline", async (t) => {
  const dir = await makeFixture({ "a.txt": "const foo = 1;" });
  t.after(() => cleanupFixture(dir));

  // This should fail because file doesn't have trailing newline
  await assert.rejects(() => 
    editFile(new Sandbox(dir), path.join(dir, "a.txt"), "1;\n", "2;\n")
  );
  const content = await fs.readFile(path.join(dir, "a.txt"), "utf8");
  assert.equal(content, "const foo = 1;");
});

test("edit at very end of file - newText is empty should NOT fail (currently allowed)", async (t) => {
  const dir = await makeFixture({ "a.txt": "const foo = 1;" });
  t.after(() => cleanupFixture(dir));

  // Note: The current implementation allows empty newText (deleting content)
  // This test documents current behavior - empty newText is allowed
  await editFile(new Sandbox(dir), path.join(dir, "a.txt"), "1;", "");
  const content = await fs.readFile(path.join(dir, "a.txt"), "utf8");
  assert.equal(content, "const foo = ");
});

test("edit at very end of file - oldText is longer than remaining content should fail", async (t) => {
  const dir = await makeFixture({ "a.txt": "const foo = 1;" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(() => 
    editFile(new Sandbox(dir), path.join(dir, "a.txt"), "1;x", "2;")
  );
  const content = await fs.readFile(path.join(dir, "a.txt"), "utf8");
  assert.equal(content, "const foo = 1;");
});

test("edit at very end of file with CRLF line endings", async (t) => {
  const dir = await makeFixture({ "a.txt": "const foo = 1;\r\n" });
  t.after(() => cleanupFixture(dir));

  await editFile(new Sandbox(dir), path.join(dir, "a.txt"), "1;\r\n", "2;\r\n");
  const content = await fs.readFile(path.join(dir, "a.txt"), "utf8");
  assert.equal(content, "const foo = 2;\r\n");
});

test("edit at very end of file with CRLF, using LF in oldText", async (t) => {
  const dir = await makeFixture({ "a.txt": "const foo = 1;\r\n" });
  t.after(() => cleanupFixture(dir));

  await editFile(new Sandbox(dir), path.join(dir, "a.txt"), "1;\n", "2;\n");
  const content = await fs.readFile(path.join(dir, "a.txt"), "utf8");
  assert.equal(content, "const foo = 2;\r\n");
});

test("edit entire file content", async (t) => {
  const dir = await makeFixture({ "a.txt": "Hello World" });
  t.after(() => cleanupFixture(dir));

  await editFile(new Sandbox(dir), path.join(dir, "a.txt"), "Hello World", "Goodbye");
  const content = await fs.readFile(path.join(dir, "a.txt"), "utf8");
  assert.equal(content, "Goodbye");
});

test("edit from middle to end of file", async (t) => {
  const dir = await makeFixture({ "a.txt": "const foo = 1;" });
  t.after(() => cleanupFixture(dir));

  await editFile(new Sandbox(dir), path.join(dir, "a.txt"), "foo = 1;", "bar = 2;");
  const content = await fs.readFile(path.join(dir, "a.txt"), "utf8");
  assert.equal(content, "const bar = 2;");
});

test("edit at end with allowMultipleMatches - oldText appears only once at end", async (t) => {
  const dir = await makeFixture({ "a.txt": "a b c" });
  t.after(() => cleanupFixture(dir));

  await editFile(new Sandbox(dir), path.join(dir, "a.txt"), "c", "d", { allowMultipleMatches: true });
  const content = await fs.readFile(path.join(dir, "a.txt"), "utf8");
  assert.equal(content, "a b d");
});

test("edit at end with allowMultipleMatches - oldText appears multiple times including at end", async (t) => {
  const dir = await makeFixture({ "a.txt": "a a a" });
  t.after(() => cleanupFixture(dir));

  await editFile(new Sandbox(dir), path.join(dir, "a.txt"), "a", "b", { allowMultipleMatches: true });
  const content = await fs.readFile(path.join(dir, "a.txt"), "utf8");
  assert.equal(content, "b b b");
});

test("edit at end of file - oldText matches newline at end (needs allowMultipleMatches)", async (t) => {
  const dir = await makeFixture({ "a.txt": "line1\nline2\n" });
  t.after(() => cleanupFixture(dir));

  // Newline appears twice, so we need allowMultipleMatches
  await editFile(new Sandbox(dir), path.join(dir, "a.txt"), "\n", "\n\n", { allowMultipleMatches: true });
  const content = await fs.readFile(path.join(dir, "a.txt"), "utf8");
  assert.equal(content, "line1\n\nline2\n\n");
});

test("edit at end of file - oldText is newline, newText is empty (currently allowed)", async (t) => {
  const dir = await makeFixture({ "a.txt": "line1\n" });
  t.after(() => cleanupFixture(dir));

  // Note: The current implementation allows empty newText (deleting content)
  // This test documents current behavior
  await editFile(new Sandbox(dir), path.join(dir, "a.txt"), "\n", "");
  const content = await fs.readFile(path.join(dir, "a.txt"), "utf8");
  assert.equal(content, "line1");
});

test("edit at end of file - multiline content, edit last line", async (t) => {
  const dir = await makeFixture({ "a.txt": "line1\nline2\nline3" });
  t.after(() => cleanupFixture(dir));

  await editFile(new Sandbox(dir), path.join(dir, "a.txt"), "line3", "line3_modified");
  const content = await fs.readFile(path.join(dir, "a.txt"), "utf8");
  assert.equal(content, "line1\nline2\nline3_modified");
});

test("edit at end of file - multiline content with trailing newline, edit last line", async (t) => {
  const dir = await makeFixture({ "a.txt": "line1\nline2\nline3\n" });
  t.after(() => cleanupFixture(dir));

  await editFile(new Sandbox(dir), path.join(dir, "a.txt"), "line3\n", "line3_modified\n");
  const content = await fs.readFile(path.join(dir, "a.txt"), "utf8");
  assert.equal(content, "line1\nline2\nline3_modified\n");
});

test("edit at end of file - file with only one line no newline", async (t) => {
  const dir = await makeFixture({ "a.txt": "single line" });
  t.after(() => cleanupFixture(dir));

  await editFile(new Sandbox(dir), path.join(dir, "a.txt"), "line", "modified");
  const content = await fs.readFile(path.join(dir, "a.txt"), "utf8");
  assert.equal(content, "single modified");
});

test("edit at end of file - empty file should fail", async (t) => {
  const dir = await makeFixture({ "a.txt": "" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(() => 
    editFile(new Sandbox(dir), path.join(dir, "a.txt"), "anything", "something")
  );
  const content = await fs.readFile(path.join(dir, "a.txt"), "utf8");
  assert.equal(content, "");
});

test("edit at end of file - oldText matches partial word at end", async (t) => {
  const dir = await makeFixture({ "a.txt": "hello" });
  t.after(() => cleanupFixture(dir));

  await editFile(new Sandbox(dir), path.join(dir, "a.txt"), "lo", "p");
  const content = await fs.readFile(path.join(dir, "a.txt"), "utf8");
  assert.equal(content, "help");
});

test("edit at end of file - oldText matches entire last word", async (t) => {
  const dir = await makeFixture({ "a.txt": "hello world" });
  t.after(() => cleanupFixture(dir));

  await editFile(new Sandbox(dir), path.join(dir, "a.txt"), "world", "earth");
  const content = await fs.readFile(path.join(dir, "a.txt"), "utf8");
  assert.equal(content, "hello earth");
});

test("edit at end of file - CRLF file, edit with LF oldText at end", async (t) => {
  const dir = await makeFixture({ "a.txt": "const foo = 1;\r\n" });
  t.after(() => cleanupFixture(dir));

  await editFile(new Sandbox(dir), path.join(dir, "a.txt"), "1;\n", "2;\n");
  const content = await fs.readFile(path.join(dir, "a.txt"), "utf8");
  assert.equal(content, "const foo = 2;\r\n");
});

test("edit at end of file - mixed line endings in file", async (t) => {
  const dir = await makeFixture({ "a.txt": "line1\r\nline2\n" });
  t.after(() => cleanupFixture(dir));

  // File has CRLF then LF, so detectLineEnding will return CRLF
  // But we're editing the last line which has LF
  await editFile(new Sandbox(dir), path.join(dir, "a.txt"), "line2\n", "line2_modified\n");
  const content = await fs.readFile(path.join(dir, "a.txt"), "utf8");
  // The file's dominant line ending is CRLF (because it contains \r\n)
  // So after normalization and restore, the last line should become CRLF
  assert.equal(content, "line1\r\nline2_modified\r\n");
});

test("edit at end - file with only newline", async (t) => {
  const dir = await makeFixture({ "a.txt": "\n" });
  t.after(() => cleanupFixture(dir));

  await editFile(new Sandbox(dir), path.join(dir, "a.txt"), "\n", "\n\n");
  const content = await fs.readFile(path.join(dir, "a.txt"), "utf8");
  assert.equal(content, "\n\n");
});

test("edit at end - file with whitespace at end", async (t) => {
  const dir = await makeFixture({ "a.txt": "hello   " });
  t.after(() => cleanupFixture(dir));

  await editFile(new Sandbox(dir), path.join(dir, "a.txt"), "   ", " world");
  const content = await fs.readFile(path.join(dir, "a.txt"), "utf8");
  assert.equal(content, "hello world");
});

test("edit at end - oldText is whitespace at end", async (t) => {
  const dir = await makeFixture({ "a.txt": "hello\n" });
  t.after(() => cleanupFixture(dir));

  await editFile(new Sandbox(dir), path.join(dir, "a.txt"), "\n", " world\n");
  const content = await fs.readFile(path.join(dir, "a.txt"), "utf8");
  assert.equal(content, "hello world\n");
});

test("edit at end - very long line, edit at end", async (t) => {
  const longLine = "a".repeat(1000) + "z";
  const dir = await makeFixture({ "a.txt": longLine });
  t.after(() => cleanupFixture(dir));

  await editFile(new Sandbox(dir), path.join(dir, "a.txt"), "z", "Z");
  const content = await fs.readFile(path.join(dir, "a.txt"), "utf8");
  assert.equal(content, "a".repeat(1000) + "Z");
});

test("edit at end - file with BOM (Byte Order Mark)", async (t) => {
  const dir = await makeFixture({ "a.txt": "\uFEFFconst foo = 1;" });
  t.after(() => cleanupFixture(dir));

  await editFile(new Sandbox(dir), path.join(dir, "a.txt"), "1;", "2;");
  const content = await fs.readFile(path.join(dir, "a.txt"), "utf8");
  assert.equal(content, "\uFEFFconst foo = 2;");
});

test("edit at end - file with special characters at end", async (t) => {
  const dir = await makeFixture({ "a.txt": "hello!@#$%" });
  t.after(() => cleanupFixture(dir));

  await editFile(new Sandbox(dir), path.join(dir, "a.txt"), "!@#$%", "12345");
  const content = await fs.readFile(path.join(dir, "a.txt"), "utf8");
  assert.equal(content, "hello12345");
});

test("edit at end - file with emoji at end", async (t) => {
  const dir = await makeFixture({ "a.txt": "hello 😀" });
  t.after(() => cleanupFixture(dir));

  await editFile(new Sandbox(dir), path.join(dir, "a.txt"), "😀", "👍");
  const content = await fs.readFile(path.join(dir, "a.txt"), "utf8");
  assert.equal(content, "hello 👍");
});

test("edit at end - file with Unicode escape sequences at end", async (t) => {
  // File contains literal escape sequences (backslash-u format)
  const dir = await makeFixture({ "a.txt": "const x = '\\\\u2024';" });
  t.after(() => cleanupFixture(dir));

  await editFile(new Sandbox(dir), path.join(dir, "a.txt"), "\\\\u2024", "\\\\u2219");
  const content = await fs.readFile(path.join(dir, "a.txt"), "utf8");
  assert.equal(content, "const x = '\\\\u2219';");
});

test("edit at end - concurrent edits at end of same file", async (t) => {
  const dir = await makeFixture({ "a.txt": "a b c" });
  t.after(() => cleanupFixture(dir));

  const filePath = path.join(dir, "a.txt");
  
  // Concurrent edits to the same file should be serialized
  await Promise.all([
    editFile(new Sandbox(dir), filePath, "b", "B"),
    editFile(new Sandbox(dir), filePath, "c", "C"),
  ]);
  
  const content = await fs.readFile(filePath, "utf8");
  assert.equal(content, "a B C");
});

test("edit at end - file with tabs at end", async (t) => {
  const dir = await makeFixture({ "a.txt": "hello\t\t" });
  t.after(() => cleanupFixture(dir));

  await editFile(new Sandbox(dir), path.join(dir, "a.txt"), "\t\t", "  ");
  const content = await fs.readFile(path.join(dir, "a.txt"), "utf8");
  assert.equal(content, "hello  ");
});

test("edit at end - file with null bytes should handle gracefully", async (t) => {
  const dir = await makeFixture({ "a.txt": "hello\0world" });
  t.after(() => cleanupFixture(dir));

  // Null bytes in strings might cause issues
  await editFile(new Sandbox(dir), path.join(dir, "a.txt"), "\0world", "\0earth");
  const content = await fs.readFile(path.join(dir, "a.txt"), "utf8");
  assert.equal(content, "hello\0earth");
});
