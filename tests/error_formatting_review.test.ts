import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { editFile } from "../src/tools/edit.ts";
import { readFile } from "../src/tools/read.ts";
import { peekFile } from "../src/tools/peek.ts";
import { makeFixture, cleanupFixture } from "./fixtures.ts";
import { Sandbox } from "../src/sandbox/sandbox.ts";

// Regression tests for the unified-error-formatting review fixes: every tool error carries the
// "<tool> error: <message>\nParameters: ..." shape, markdown targets are exempt from the
// code-fence heuristic, and JSON outlines handle braces inside string literals.

test("read: binary-file error uses the unified format with a Parameters line", async (t) => {
  const dir = await makeFixture({ "blob.bin": "abc\x00def" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(
    () => readFile(new Sandbox(dir), "blob.bin", { offset: 1, limit: 1 }),
    (err: Error) => {
      assert.match(err.message, /^read error: .*binary file/);
      assert.match(err.message, /^Parameters: path="blob.bin"/m);
      return true;
    }
  );
});

test("read: streaming errno error uses the unified format", async (t) => {
  const dir = await makeFixture({});
  t.after(() => cleanupFixture(dir));

  await assert.rejects(
    () => readFile(new Sandbox(dir), "missing.txt", {}),
    (err: Error) => {
      assert.match(err.message, /^read error: Could not read file "missing.txt": file not found/);
      assert.match(err.message, /^Parameters: path="missing.txt"$/m);
      return true;
    }
  );
});

test("read: offset-beyond-EOF error (streaming path) uses the unified format", async (t) => {
  const dir = await makeFixture({ "small.txt": "one\ntwo\n" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(
    () => readFile(new Sandbox(dir), "small.txt", { offset: 99 }),
    (err: Error) => {
      assert.match(err.message, /^read error: Offset 99 is beyond end of file \(3 line\(s\) total\)/);
      assert.match(err.message, /^Parameters: path="small.txt", offset=99$/m);
      return true;
    }
  );
});

test("edit: oldText === newText error uses the unified format with parameters", async (t) => {
  const dir = await makeFixture({ "a.txt": "const foo = 1;\n" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(
    () => editFile(new Sandbox(dir), path.join(dir, "a.txt"), "same", "same"),
    (err: Error) => {
      assert.match(err.message, /^edit error: .*oldText and newText must differ/);
      assert.match(err.message, /^Parameters: /m);
      return true;
    }
  );
});

test("edit: code-fence rejection uses the unified format and echoes the offending values", async (t) => {
  const dir = await makeFixture({ "a.txt": "const foo = 1;\n" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(
    () => editFile(new Sandbox(dir), path.join(dir, "a.txt"), "const foo = 1;", "```js\nconst foo = 2;\n```"),
    (err: Error) => {
      assert.match(err.message, /^edit error: .*newText appears to be wrapped in a markdown code block/);
      assert.match(err.message, /oldText=/);
      assert.match(err.message, /newText=/);
      return true;
    }
  );
});

test("edit: a markdown file that genuinely is one fenced block is not rejected", async (t) => {
  const dir = await makeFixture({ "snippet.md": "```js\nconst foo = 1;\n```\n" });
  t.after(() => cleanupFixture(dir));

  // Verbatim fence-shaped oldText matches the file directly — no false "strip the fences" error.
  await editFile(new Sandbox(dir), path.join(dir, "snippet.md"), "```js\nconst foo = 1;\n```", "```js\nconst foo = 2;\n```");
  const content = await fs.readFile(path.join(dir, "snippet.md"), "utf8");
  assert.equal(content, "```js\nconst foo = 2;\n```\n");
});

test("edit: markdown target falls back to the stripped form when the verbatim text is absent", async (t) => {
  const dir = await makeFixture({ "doc.md": "const foo = 1;\n" });
  t.after(() => cleanupFixture(dir));

  // The file has no fences at all, so the model's fence-wrapped arguments are stripped and the
  // edit goes through instead of failing with a misleading "oldText not found".
  await editFile(new Sandbox(dir), path.join(dir, "doc.md"), "```js\nconst foo = 1;\n```", "```js\nconst foo = 2;\n```");
  const content = await fs.readFile(path.join(dir, "doc.md"), "utf8");
  assert.equal(content, "const foo = 2;\n");
});

test("edit: non-markdown target still rejects fence-wrapped arguments outright", async (t) => {
  const dir = await makeFixture({ "a.ts": "const foo = 1;\n" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(
    () => editFile(new Sandbox(dir), path.join(dir, "a.ts"), "const foo = 1;", "```js\nconst foo = 2;\n```"),
    /newText appears to be wrapped in a markdown code block/
  );
  const content = await fs.readFile(path.join(dir, "a.ts"), "utf8");
  assert.equal(content, "const foo = 1;\n");
});

test("peek: JSON outline keeps top-level keys when strings contain braces", async (t) => {
  const dir = await makeFixture({
    "config.json": '{\n  "name": "pkg",\n  "template": "use {braces} here",\n  "list": [\n    "a}"\n  ]\n}\n',
  });
  t.after(() => cleanupFixture(dir));

  const result = await peekFile(new Sandbox(dir), path.join(dir, "config.json"));
  const text = result.lines.map((l) => l.text).join("\n");
  assert.match(text, /"name":/);
  assert.match(text, /"template":/);
  assert.match(text, /"list":/);
});
