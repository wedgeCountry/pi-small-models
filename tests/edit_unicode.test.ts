import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { editFile } from "../src/tools/edit.ts";
import { makeFixture, cleanupFixture } from "./fixtures.ts";
import { Sandbox } from "../src/sandbox/sandbox.ts";

test("handles Unicode characters in oldText correctly", async (t) => {
  const dir = await makeFixture({ "a.txt": "const foo = 1;\n// Unicode: \u2024\u2219\u2981\nconst bar = 2;\n" });
  t.after(() => cleanupFixture(dir));

  // Try to edit a line that contains Unicode characters
  await editFile(new Sandbox(dir), path.join(dir, "a.txt"), "// Unicode: \u2024\u2219\u2981", "// Unicode: replaced");
  const content = await fs.readFile(path.join(dir, "a.txt"), "utf8");
  assert.equal(content, "const foo = 1;\n// Unicode: replaced\nconst bar = 2;\n");
});

test("handles Unicode characters in file content with CRLF line endings", async (t) => {
  const dir = await makeFixture({ "a.txt": "const foo = 1;\r\n// Unicode: \u2024\u2219\u2981\r\nconst bar = 2;\r\n" });
  t.after(() => cleanupFixture(dir));

  // Try to edit with LF line endings in oldText against CRLF file
  await editFile(new Sandbox(dir), path.join(dir, "a.txt"), "// Unicode: \u2024\u2219\u2981", "// Unicode: replaced");
  const content = await fs.readFile(path.join(dir, "a.txt"), "utf8");
  assert.equal(content, "const foo = 1;\r\n// Unicode: replaced\r\nconst bar = 2;\r\n");
});

test("handles Unicode characters in oldText with CRLF", async (t) => {
  const dir = await makeFixture({ "a.txt": "const foo = 1;\n// Unicode: \u2024\u2219\u2981\nconst bar = 2;\n" });
  t.after(() => cleanupFixture(dir));

  // Try to edit with CRLF line endings in oldText against LF file
  await editFile(new Sandbox(dir), path.join(dir, "a.txt"), "// Unicode: \u2024\u2219\u2981\r\n", "// Unicode: replaced\r\n");
  const content = await fs.readFile(path.join(dir, "a.txt"), "utf8");
  assert.equal(content, "const foo = 1;\n// Unicode: replaced\nconst bar = 2;\n");
});

test("fails when Unicode characters in oldText don't match file content", async (t) => {
  const dir = await makeFixture({ "a.txt": "const foo = 1;\n// Unicode: \u2024\u2219\u2981\nconst bar = 2;\n" });
  t.after(() => cleanupFixture(dir));

  // Try to edit with wrong Unicode characters
  await assert.rejects(() => 
    editFile(new Sandbox(dir), path.join(dir, "a.txt"), "// Unicode: \u2024\u2219\u2982", "// Unicode: replaced")
  );
});

test("handles mixed Unicode and regular characters", async (t) => {
  const dir = await makeFixture({ "a.txt": "const foo = 1;\n// Comment with Unicode: \u2024 and text\nconst bar = 2;\n" });
  t.after(() => cleanupFixture(dir));

  await editFile(new Sandbox(dir), path.join(dir, "a.txt"), "// Comment with Unicode: \u2024 and text", "// Comment replaced");
  const content = await fs.readFile(path.join(dir, "a.txt"), "utf8");
  assert.equal(content, "const foo = 1;\n// Comment replaced\nconst bar = 2;\n");
});