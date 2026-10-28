import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { editFile } from "../src/tools/edit.ts";
import { makeFixture, cleanupFixture } from "./fixtures.ts";
import { Sandbox } from "../src/sandbox/sandbox.ts";

// Regression tests for models handing over oldText/newText wrapped in markdown code fences.

test("edit rejects newText wrapped in a code fence", async (t) => {
  const dir = await makeFixture({ "a.txt": "const foo = 1;\n" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(
    () =>
      editFile(new Sandbox(dir), path.join(dir, "a.txt"), "const foo = 1;", "```js\nconst foo = 2;\n```"),
    /newText appears to be wrapped in a markdown code block/
  );
  const content = await fs.readFile(path.join(dir, "a.txt"), "utf8");
  assert.equal(content, "const foo = 1;\n");
});

test("edit rejects oldText wrapped in a code fence", async (t) => {
  const dir = await makeFixture({ "a.txt": "const foo = 1;\n" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(
    () =>
      editFile(new Sandbox(dir), path.join(dir, "a.txt"), "```js\nconst foo = 1;\n```", "const foo = 2;"),
    /oldText appears to be wrapped in a markdown code block/
  );
  const content = await fs.readFile(path.join(dir, "a.txt"), "utf8");
  assert.equal(content, "const foo = 1;\n");
});

test("edit rejects fence-wrapped text without a language tag", async (t) => {
  const dir = await makeFixture({ "a.txt": "const foo = 1;\n" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(
    () => editFile(new Sandbox(dir), path.join(dir, "a.txt"), "const foo = 1;", "```\nconst foo = 2;\n```"),
    /newText appears to be wrapped in a markdown code block/
  );
});

test("edit rejects fence-wrapped text with CRLF line endings", async (t) => {
  const dir = await makeFixture({ "a.txt": "const foo = 1;\r\n" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(
    () => editFile(new Sandbox(dir), path.join(dir, "a.txt"), "const foo = 1;", "```js\r\nconst foo = 2;\r\n```"),
    /newText appears to be wrapped in a markdown code block/
  );
});

test("edit allows fenced markdown content that is genuine file content", async (t) => {
  const dir = await makeFixture({ "doc.md": "```js\nconst foo = 1;\n```\n" });
  t.after(() => cleanupFixture(dir));

  await editFile(new Sandbox(dir), path.join(dir, "doc.md"), "const foo = 1;", "const foo = 2;");
  const content = await fs.readFile(path.join(dir, "doc.md"), "utf8");
  assert.equal(content, "```js\nconst foo = 2;\n```\n");
});

test("edit allows oldText spanning a fenced block plus surrounding lines", async (t) => {
  const dir = await makeFixture({ "doc.md": "intro\n```js\nconst foo = 1;\n```\n" });
  t.after(() => cleanupFixture(dir));

  await editFile(
    new Sandbox(dir),
    path.join(dir, "doc.md"),
    "intro\n```js\nconst foo = 1;\n```",
    "intro\n```js\nconst foo = 2;\n```"
  );
  const content = await fs.readFile(path.join(dir, "doc.md"), "utf8");
  assert.equal(content, "intro\n```js\nconst foo = 2;\n```\n");
});

test("edit allows text starting and ending with fences but containing inner fence lines", async (t) => {
  const dir = await makeFixture({ "doc.md": "x\n" });
  t.after(() => cleanupFixture(dir));

  await editFile(
    new Sandbox(dir),
    path.join(dir, "doc.md"),
    "x",
    "```js\nouter\n```js\ninner\n```\n```"
  );
  const content = await fs.readFile(path.join(dir, "doc.md"), "utf8");
  assert.equal(content, "```js\nouter\n```js\ninner\n```\n```\n");
});
