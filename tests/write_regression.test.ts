import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { writeFile } from "../src/tools/write.ts";
import { makeFixture, cleanupFixture } from "./fixtures.ts";
import { Sandbox } from "../src/sandbox/sandbox.ts";

// Regression tests for write tool cutting off content

test("write file with content exactly 2931 bytes", async (t) => {
  const dir = await makeFixture({});
  t.after(() => cleanupFixture(dir));

  const content = "x".repeat(2931);
  const filePath = path.join(dir, "test.txt");

  await writeFile(new Sandbox(dir), filePath, content);

  const written = await fs.readFile(filePath, "utf8");
  assert.equal(written.length, 2931, `Expected 2931 bytes, got ${written.length}`);
  assert.equal(written, content);
});

test("write file with content around 2931 bytes (2930)", async (t) => {
  const dir = await makeFixture({});
  t.after(() => cleanupFixture(dir));

  const content = "x".repeat(2930);
  const filePath = path.join(dir, "test.txt");

  await writeFile(new Sandbox(dir), filePath, content);

  const written = await fs.readFile(filePath, "utf8");
  assert.equal(written.length, 2930);
  assert.equal(written, content);
});

test("write file with content around 2931 bytes (2932)", async (t) => {
  const dir = await makeFixture({});
  t.after(() => cleanupFixture(dir));

  const content = "x".repeat(2932);
  const filePath = path.join(dir, "test.txt");

  await writeFile(new Sandbox(dir), filePath, content);

  const written = await fs.readFile(filePath, "utf8");
  assert.equal(written.length, 2932);
  assert.equal(written, content);
});

test("write file with multiline content around 2931 bytes", async (t) => {
  const dir = await makeFixture({});
  t.after(() => cleanupFixture(dir));

  // Create content with newlines that totals around 2931 bytes
  const line = "x".repeat(100);
  const lines = [];
  let total = 0;
  while (total < 2931) {
    lines.push(line);
    total += line.length + 1; // +1 for newline
  }
  // Trim to exactly 2931
  let content = lines.join("\n");
  if (content.length > 2931) {
    content = content.slice(0, 2931);
  }
  
  const filePath = path.join(dir, "test.txt");

  await writeFile(new Sandbox(dir), filePath, content);

  const written = await fs.readFile(filePath, "utf8");
  assert.equal(written.length, content.length);
  assert.equal(written, content);
});

test("write file with content exactly 4096 bytes (common buffer size)", async (t) => {
  const dir = await makeFixture({});
  t.after(() => cleanupFixture(dir));

  const content = "x".repeat(4096);
  const filePath = path.join(dir, "test.txt");

  await writeFile(new Sandbox(dir), filePath, content);

  const written = await fs.readFile(filePath, "utf8");
  assert.equal(written.length, 4096);
  assert.equal(written, content);
});

test("write file with content exactly 8192 bytes (2 * 4096)", async (t) => {
  const dir = await makeFixture({});
  t.after(() => cleanupFixture(dir));

  const content = "x".repeat(8192);
  const filePath = path.join(dir, "test.txt");

  await writeFile(new Sandbox(dir), filePath, content);

  const written = await fs.readFile(filePath, "utf8");
  assert.equal(written.length, 8192);
  assert.equal(written, content);
});

test("write file with very long content (100KB)", async (t) => {
  const dir = await makeFixture({});
  t.after(() => cleanupFixture(dir));

  const content = "x".repeat(100 * 1024);
  const filePath = path.join(dir, "test.txt");

  await writeFile(new Sandbox(dir), filePath, content);

  const written = await fs.readFile(filePath, "utf8");
  assert.equal(written.length, 100 * 1024);
  assert.equal(written, content);
});

test("write file with Unicode content", async (t) => {
  const dir = await makeFixture({});
  t.after(() => cleanupFixture(dir));

  const content = "Hello 世界 🌍".repeat(100);
  const filePath = path.join(dir, "test.txt");

  await writeFile(new Sandbox(dir), filePath, content);

  const written = await fs.readFile(filePath, "utf8");
  assert.equal(written, content);
});

test("write file with CRLF line endings", async (t) => {
  const dir = await makeFixture({});
  t.after(() => cleanupFixture(dir));

  const content = "line1\r\nline2\r\nline3\r\n";
  const filePath = path.join(dir, "test.txt");

  await writeFile(new Sandbox(dir), filePath, content);

  const written = await fs.readFile(filePath, "utf8");
  assert.equal(written, content);
});

test("write file with mixed line endings", async (t) => {
  const dir = await makeFixture({});
  t.after(() => cleanupFixture(dir));

  const content = "line1\nline2\r\nline3\n";
  const filePath = path.join(dir, "test.txt");

  await writeFile(new Sandbox(dir), filePath, content);

  const written = await fs.readFile(filePath, "utf8");
  assert.equal(written, content);
});

test("write file with null bytes", async (t) => {
  const dir = await makeFixture({});
  t.after(() => cleanupFixture(dir));

  const content = "hello\0world\0test";
  const filePath = path.join(dir, "test.txt");

  await writeFile(new Sandbox(dir), filePath, content);

  const written = await fs.readFile(filePath, "utf8");
  assert.equal(written, content);
});

test("write file with trailing newline", async (t) => {
  const dir = await makeFixture({});
  t.after(() => cleanupFixture(dir));

  const content = "hello\n";
  const filePath = path.join(dir, "test.txt");

  await writeFile(new Sandbox(dir), filePath, content);

  const written = await fs.readFile(filePath, "utf8");
  assert.equal(written, content);
});

test("write file without trailing newline", async (t) => {
  const dir = await makeFixture({});
  t.after(() => cleanupFixture(dir));

  const content = "hello";
  const filePath = path.join(dir, "test.txt");

  await writeFile(new Sandbox(dir), filePath, content);

  const written = await fs.readFile(filePath, "utf8");
  assert.equal(written, content);
});

test("write file with exactly 70 lines", async (t) => {
  const dir = await makeFixture({});
  t.after(() => cleanupFixture(dir));

  const lines = [];
  for (let i = 0; i < 70; i++) {
    lines.push(`Line ${i + 1}`);
  }
  const content = lines.join("\n");
  const filePath = path.join(dir, "test.txt");

  await writeFile(new Sandbox(dir), filePath, content);

  const written = await fs.readFile(filePath, "utf8");
  assert.equal(written, content);
  const writtenLines = written.split("\n");
  assert.equal(writtenLines.length, 70);
});

test("write file with exactly 70 lines and trailing newline", async (t) => {
  const dir = await makeFixture({});
  t.after(() => cleanupFixture(dir));

  const lines = [];
  for (let i = 0; i < 70; i++) {
    lines.push(`Line ${i + 1}`);
  }
  const content = lines.join("\n") + "\n";
  const filePath = path.join(dir, "test.txt");

  await writeFile(new Sandbox(dir), filePath, content);

  const written = await fs.readFile(filePath, "utf8");
  assert.equal(written, content);
  const writtenLines = written.split("\n");
  assert.equal(writtenLines.length, 71); // 70 lines + empty line from trailing newline
});

test("write file with content that has line 70", async (t) => {
  const dir = await makeFixture({});
  t.after(() => cleanupFixture(dir));

  const lines = [];
  for (let i = 0; i < 100; i++) {
    lines.push(`Line ${i + 1}`);
  }
  const content = lines.join("\n");
  const filePath = path.join(dir, "test.txt");

  await writeFile(new Sandbox(dir), filePath, content);

  const written = await fs.readFile(filePath, "utf8");
  assert.equal(written, content);
  
  // Verify line 70 exists
  const writtenLines = written.split("\n");
  assert.equal(writtenLines[69], "Line 70");
});

test("write file and verify content at line 70", async (t) => {
  const dir = await makeFixture({});
  t.after(() => cleanupFixture(dir));

  // Create content similar to a C# file with exactly 70 lines
  const lines = [
    "using System;",
    "using System.Collections.Generic;",
    "",
    "namespace Test",
    "{",
    "    public class TestClass",
    "    {",
  ];
  for (let i = 0; i < 61; i++) {
    lines.push(`        public void Method${i + 1}() { }`);
  }
  lines.push("    }");
  lines.push("}");
  
  const content = lines.join("\n");
  const filePath = path.join(dir, "test.cs");

  await writeFile(new Sandbox(dir), filePath, content);

  const written = await fs.readFile(filePath, "utf8");
  assert.equal(written, content);
  
  const writtenLines = written.split("\n");
  assert.equal(writtenLines.length, 70, `Expected exactly 70 lines, got ${writtenLines.length}`);
  assert.ok(writtenLines[69].length > 0, "Line 70 should not be empty");
});

test("write file with multibyte characters at specific positions", async (t) => {
  const dir = await makeFixture({});
  t.after(() => cleanupFixture(dir));

  // Create content with multibyte characters (emoji are 2 bytes each in UTF-16)
  let content = "";
  for (let i = 0; i < 2931; i++) {
    content += String.fromCharCode(97 + (i % 26)); // a-z
  }
  
  const filePath = path.join(dir, "test.txt");

  await writeFile(new Sandbox(dir), filePath, content);

  const written = await fs.readFile(filePath, "utf8");
  assert.equal(written.length, 2931);
  assert.equal(written, content);
});

test("write file with emoji at position 2931", async (t) => {
  const dir = await makeFixture({});
  t.after(() => cleanupFixture(dir));

  const content = "x".repeat(2928) + "😀😀😀"; // 2928 + 3*2 = 2934 bytes
  const filePath = path.join(dir, "test.txt");

  await writeFile(new Sandbox(dir), filePath, content);

  const written = await fs.readFile(filePath, "utf8");
  assert.equal(written.length, content.length);
  assert.equal(written, content);
});

test("write empty file", async (t) => {
  const dir = await makeFixture({});
  t.after(() => cleanupFixture(dir));

  const content = "";
  const filePath = path.join(dir, "test.txt");

  await writeFile(new Sandbox(dir), filePath, content);

  const written = await fs.readFile(filePath, "utf8");
  assert.equal(written, content);
});

test("write file with single character", async (t) => {
  const dir = await makeFixture({});
  t.after(() => cleanupFixture(dir));

  const content = "x";
  const filePath = path.join(dir, "test.txt");

  await writeFile(new Sandbox(dir), filePath, content);

  const written = await fs.readFile(filePath, "utf8");
  assert.equal(written, content);
});

test("write file with special characters", async (t) => {
  const dir = await makeFixture({});
  t.after(() => cleanupFixture(dir));

  const content = "!@#$%^&*()_+-={}[]|\\:;\"'<>?,./";
  const filePath = path.join(dir, "test.txt");

  await writeFile(new Sandbox(dir), filePath, content);

  const written = await fs.readFile(filePath, "utf8");
  assert.equal(written, content);
});

test("write file with tabs and spaces", async (t) => {
  const dir = await makeFixture({});
  t.after(() => cleanupFixture(dir));

  const content = "\t  \t  \n\t  \t  \n";
  const filePath = path.join(dir, "test.txt");

  await writeFile(new Sandbox(dir), filePath, content);

  const written = await fs.readFile(filePath, "utf8");
  assert.equal(written, content);
});

test("write file with BOM", async (t) => {
  const dir = await makeFixture({});
  t.after(() => cleanupFixture(dir));

  const content = "\uFEFFconst foo = 1;";
  const filePath = path.join(dir, "test.txt");

  await writeFile(new Sandbox(dir), filePath, content);

  const written = await fs.readFile(filePath, "utf8");
  assert.equal(written, content);
});

test("write file to nested directory", async (t) => {
  const dir = await makeFixture({});
  t.after(() => cleanupFixture(dir));

  const content = "test content";
  const filePath = path.join(dir, "a", "b", "c", "test.txt");

  await writeFile(new Sandbox(dir), filePath, content);

  const written = await fs.readFile(filePath, "utf8");
  assert.equal(written, content);
});

test("write file and verify byte length matches", async (t) => {
  const dir = await makeFixture({});
  t.after(() => cleanupFixture(dir));

  // Use Buffer.byteLength to get actual byte count
  const content = "Hello 世界 🌍";
  const expectedBytes = Buffer.byteLength(content, "utf8");
  const filePath = path.join(dir, "test.txt");

  await writeFile(new Sandbox(dir), filePath, content);

  const written = await fs.readFile(filePath, "utf8");
  assert.equal(written, content);
  
  // Verify actual bytes on disk
  const stats = await fs.stat(filePath);
  assert.equal(stats.size, expectedBytes);
});

test("write file with content that has newline at position 2931", async (t) => {
  const dir = await makeFixture({});
  t.after(() => cleanupFixture(dir));

  const before = "x".repeat(2930);
  const after = "y".repeat(10);
  const content = before + "\n" + after;
  const filePath = path.join(dir, "test.txt");

  await writeFile(new Sandbox(dir), filePath, content);

  const written = await fs.readFile(filePath, "utf8");
  assert.equal(written, content);
  assert.equal(written.length, content.length);
});
