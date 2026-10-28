import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { readFile, getExtension, registerReadTool } from "../src/tools/read.ts";
import { insertText } from "../src/tools/insert.ts";
import { peekFile } from "../src/tools/peek.ts";
import { makeFixture, cleanupFixture } from "./fixtures.ts";
import { Sandbox } from "../src/sandbox/sandbox.ts";

test("read totalLines matches insert's accepted line range (trailing newline)", async (t) => {
  const dir = await makeFixture({ "a.txt": "line1\nline2\nline3\n" });
  t.after(() => cleanupFixture(dir));

  const result = await readFile(new Sandbox(dir), path.join(dir, "a.txt"));
  // insert accepts line 0..totalLines; inserting at totalLines must succeed
  await insertText(new Sandbox(dir), path.join(dir, "a.txt"), result.totalLines, "inserted");
  const updated = await readFile(new Sandbox(dir), path.join(dir, "a.txt"));
  assert.ok(updated.lines.some((l) => l.text === "inserted"));
});

test("read totalLines matches insert's accepted line range (no trailing newline)", async (t) => {
  const dir = await makeFixture({ "a.txt": "line1\nline2\nline3" });
  t.after(() => cleanupFixture(dir));

  const result = await readFile(new Sandbox(dir), path.join(dir, "a.txt"));
  assert.equal(result.totalLines, 3);
  await insertText(new Sandbox(dir), path.join(dir, "a.txt"), result.totalLines, "inserted");
  const updated = await readFile(new Sandbox(dir), path.join(dir, "a.txt"));
  assert.ok(updated.lines.some((l) => l.text === "inserted"));
});

test("insert at read's totalLines + 1 fails with the same line count read reported", async (t) => {
  const dir = await makeFixture({ "a.txt": "line1\nline2\nline3" });
  t.after(() => cleanupFixture(dir));

  const result = await readFile(new Sandbox(dir), path.join(dir, "a.txt"));
  await assert.rejects(
    insertText(new Sandbox(dir), path.join(dir, "a.txt"), result.totalLines + 1, "x"),
    new RegExp(`past the end.*${result.totalLines} line`),
  );
});

test("read error for a missing file uses a fixed ENOENT message, no host path leak", async (t) => {
  const dir = await makeFixture({ "keep.txt": "x" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(
    readFile(new Sandbox(dir), path.join(dir, "missing.txt")),
    (err: Error) => {
      assert.match(err.message, /Could not read file "missing\.txt": file not found/);
      assert.ok(!err.message.includes(dir), "must not leak the absolute host path");
      return true;
    },
  );
});

test("read error for a directory uses a fixed EISDIR message", async (t) => {
  const dir = await makeFixture({ "sub/keep.txt": "x" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(
    readFile(new Sandbox(dir), path.join(dir, "sub")),
    /Could not read file "sub": is a directory/,
  );
});

test("renderCall shows peek and visibility flags alongside offset/limit", () => {
  const registered: Record<string, unknown> = {};
  registerReadTool({
    registerTool: (tool: Record<string, unknown>) => Object.assign(registered, tool),
  } as never);
  const renderCall = registered["renderCall"] as (
    args: Record<string, unknown>,
    theme: { fg: (_: string, s: string) => string },
  ) => { render(): string[] };

  const theme = { fg: (_: string, s: string) => s, bold: (s: string) => s };
  const rendered = renderCall({ path: "a.py", peek: false }, theme);
  const flat = rendered.render().join(" ");
  assert.match(flat, /peek=false/);

  const renderedOutline = renderCall({ path: "a.py", visibility: "private" }, theme);
  assert.match(renderedOutline.render().join(" "), /private/);

  const renderedRange = renderCall({ path: "a.py", offset: 5, limit: 10 }, theme);
  assert.match(renderedRange.render().join(" "), /:5-14/);
});

test("streaming read: offset/limit on a huge file returns the right lines without loading it all", async (t) => {
  // A file far larger than the byte cap. If readFile buffers the whole file, this is
  // wasteful but still correct; the test pins the *behavior*: exact lines at the range,
  // correct totalLines, correct truncation.
  const line = "y".repeat(100);
  const lineCount = 3000;
  const dir = await makeFixture({ "huge.txt": (line + "\n").repeat(lineCount) });
  t.after(() => cleanupFixture(dir));

  const result = await readFile(new Sandbox(dir), path.join(dir, "huge.txt"), { offset: 2500, limit: 3 });
  assert.deepEqual(
    result.lines.map((l) => l.line),
    [2500, 2501, 2502],
  );
  assert.ok(result.lines.every((l) => l.text === line));
  assert.equal(result.totalLines, lineCount + 1);
  assert.equal(result.truncated, true);
});

test("peek supports JSON with a top-level keys outline", async (t) => {
  const dir = await makeFixture({
    "config.json": JSON.stringify({ name: "pkg", version: "1.0.0", scripts: { build: "tsc" } }, null, 2),
  });
  t.after(() => cleanupFixture(dir));

  const result = await peekFile(new Sandbox(dir), path.join(dir, "config.json"));
  assert.equal(result.language, "json");
  const text = result.lines.map((l) => l.text).join("\n");
  assert.match(text, /"name"/);
  assert.match(text, /"version"/);
  assert.match(text, /"scripts"/);
  assert.ok(!text.includes("tsc"), "outline should not include nested values");
});

test("peek supports YAML with a top-level keys outline", async (t) => {
  const dir = await makeFixture({
    "config.yaml": "name: pkg\nversion: 1.0.0\nscripts:\n  build: tsc\n",
  });
  t.after(() => cleanupFixture(dir));

  const result = await peekFile(new Sandbox(dir), path.join(dir, "config.yaml"));
  assert.equal(result.language, "yaml");
  const text = result.lines.map((l) => l.text).join("\n");
  assert.match(text, /name:/);
  assert.match(text, /version:/);
  assert.match(text, /scripts:/);
  assert.ok(!text.includes("build: tsc"), "outline should not include nested values");
});

test("peek supports TOML with a top-level keys outline", async (t) => {
  const dir = await makeFixture({
    "config.toml": 'name = "pkg"\nversion = "1.0.0"\n\n[dependencies]\nfoo = "1.0"\n',
  });
  t.after(() => cleanupFixture(dir));

  const result = await peekFile(new Sandbox(dir), path.join(dir, "config.toml"));
  assert.equal(result.language, "toml");
  const text = result.lines.map((l) => l.text).join("\n");
  assert.match(text, /name =/);
  assert.match(text, /version =/);
  assert.match(text, /\[dependencies\]/);
  assert.ok(!text.includes('foo = "1.0"'), "outline should not include table values");
});
