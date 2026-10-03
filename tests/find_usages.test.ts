import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { findUsages } from "../src/tools/find_usages.ts";
import { makeFixture, cleanupFixture } from "./fixtures.ts";

test("finds usages across multiple files of the same language", async (t) => {
  const dir = await makeFixture({
    "a.py": "class Handler:\n    pass\n",
    "b.py": "h = Handler()\n",
  });
  t.after(() => cleanupFixture(dir));

  const result = await findUsages(dir, "Handler", "python");
  assert.equal(result.total, 2);
  assert.deepEqual(
    result.matches.map((m) => `${m.file}:${m.kind}`).sort(),
    ["a.py:definition", "b.py:instantiation"]
  );
});

test("only scans files matching the selected language's glob", async (t) => {
  const dir = await makeFixture({
    "a.py": "class Handler:\n    pass\n",
    "b.ts": "class Handler {}\n",
  });
  t.after(() => cleanupFixture(dir));

  const pythonResult = await findUsages(dir, "Handler", "python");
  assert.equal(pythonResult.total, 1);
  assert.equal(pythonResult.matches[0]?.file, "a.py");

  const tsResult = await findUsages(dir, "Handler", "typescript");
  assert.equal(tsResult.total, 1);
  assert.equal(tsResult.matches[0]?.file, "b.ts");
});

test("resolves Python's bare-call ambiguity across the whole scanned scope, not just one file", async (t) => {
  const dir = await makeFixture({
    "models.py": "class Widget:\n    pass\n",
    "usage.py": "w = Widget()\n", // no def in THIS file — knownKind must come from the whole scan
  });
  t.after(() => cleanupFixture(dir));

  const result = await findUsages(dir, "Widget", "python");
  const usageMatch = result.matches.find((m) => m.file === "usage.py");
  assert.equal(usageMatch?.kind, "instantiation");
});

test("truncates at maxResults", async (t) => {
  const dir = await makeFixture({
    "a.py": "Handler()\nHandler()\nHandler()\n",
  });
  t.after(() => cleanupFixture(dir));

  const result = await findUsages(dir, "Handler", "python", { maxResults: 2 });
  assert.equal(result.total, 2);
  assert.equal(result.truncated, true);
});

test("does not report truncated when total exactly equals maxResults", async (t) => {
  const dir = await makeFixture({ "a.py": "Handler()\nHandler()\n" });
  t.after(() => cleanupFixture(dir));

  const result = await findUsages(dir, "Handler", "python", { maxResults: 2 });
  assert.equal(result.total, 2);
  assert.equal(result.truncated, false);
});

test("rejects a symbol that is not a plain identifier", async (t) => {
  const dir = await makeFixture({ "a.py": "x = 1\n" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(() => findUsages(dir, "Foo-Bar", "python"), /not a valid identifier/);
  await assert.rejects(() => findUsages(dir, "1Foo", "python"), /not a valid identifier/);
  await assert.rejects(() => findUsages(dir, "Foo.Bar", "python"), /not a valid identifier/);
});

test("rejects a path that does not exist", async (t) => {
  const dir = await makeFixture({});
  t.after(() => cleanupFixture(dir));

  await assert.rejects(() => findUsages(path.join(dir, "nope"), "Handler", "python"), /does not exist/);
});

test("rejects a path that names a file instead of a directory", async (t) => {
  const dir = await makeFixture({ "a.py": "x = 1\n" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(
    () => findUsages(path.join(dir, "a.py"), "Handler", "python"),
    /is a file, not a directory/
  );
});

test("does not read through a symlink that points outside the base directory", async (t) => {
  const dir = await makeFixture({ "real.py": "Handler()\n" });
  const outside = await makeFixture({ "secret.py": "Handler()  # secret\n" });
  t.after(() => Promise.all([cleanupFixture(dir), cleanupFixture(outside)]));

  const link = path.join(dir, "link.py");
  try {
    await fs.symlink(path.join(outside, "secret.py"), link, "file");
  } catch (err) {
    t.skip(`cannot create symlinks in this environment: ${(err as Error).message}`);
    return;
  }

  const result = await findUsages(dir, "Handler", "python");
  assert.equal(result.total, 1);
  assert.equal(result.matches[0]?.file, "real.py");
});

test("excludes a sandbox-restricted path even when it matches the language glob", async (t) => {
  const dir = await makeFixture({
    ".venv/lib/handler.py": "class Handler:\n    pass\n",
    "a.py": "class Handler:\n    pass\n",
  });
  t.after(() => cleanupFixture(dir));

  const result = await findUsages(dir, "Handler", "python");
  assert.equal(result.total, 1);
  assert.equal(result.matches[0]?.file, "a.py");
});

test("classifies a TypeScript instantiation end-to-end", async (t) => {
  const dir = await makeFixture({ "a.ts": "const h = new Handler();\n" });
  t.after(() => cleanupFixture(dir));

  const result = await findUsages(dir, "Handler", "typescript");
  assert.equal(result.total, 1);
  assert.equal(result.matches[0]?.kind, "instantiation");
});

test("classifies a C# base-class reference end-to-end", async (t) => {
  const dir = await makeFixture({ "Sample.cs": "public class MyHandler : Handler {\n}\n" });
  t.after(() => cleanupFixture(dir));

  const result = await findUsages(dir, "Handler", "csharp");
  assert.equal(result.total, 1);
  assert.equal(result.matches[0]?.kind, "type-reference");
});

test("auto-detects csharp from a .sln file", async (t) => {
  const dir = await makeFixture({
    "App.sln": "",
    "Sample.cs": "public class MyHandler : Handler {\n}\n",
  });
  t.after(() => cleanupFixture(dir));

  const result = await findUsages(dir, "Handler", "auto");
  assert.equal(result.total, 1);
  assert.equal(result.matches[0]?.kind, "type-reference");
});

test("auto-detects csharp from a nested .csproj file", async (t) => {
  const dir = await makeFixture({
    "src/App.csproj": "<Project />",
    "src/Sample.cs": "public class MyHandler : Handler {\n}\n",
  });
  t.after(() => cleanupFixture(dir));

  const result = await findUsages(dir, "Handler", "auto");
  assert.equal(result.total, 1);
  assert.equal(result.matches[0]?.kind, "type-reference");
});

test("auto-detects python from a .venv folder", async (t) => {
  const dir = await makeFixture({
    ".venv/pyvenv.cfg": "",
    "a.py": "class Handler:\n    pass\n",
  });
  t.after(() => cleanupFixture(dir));

  const result = await findUsages(dir, "Handler", "auto");
  assert.equal(result.total, 1);
  assert.equal(result.matches[0]?.kind, "definition");
});

test("auto-detects typescript from a node_modules folder", async (t) => {
  const dir = await makeFixture({
    "node_modules/pkg/index.js": "",
    "a.ts": "const h = new Handler();\n",
  });
  t.after(() => cleanupFixture(dir));

  const result = await findUsages(dir, "Handler", "auto");
  assert.equal(result.total, 1);
  assert.equal(result.matches[0]?.kind, "instantiation");
});

test("defaults to auto-detection when language is omitted entirely", async (t) => {
  const dir = await makeFixture({
    ".venv/pyvenv.cfg": "",
    "a.py": "class Handler:\n    pass\n",
  });
  t.after(() => cleanupFixture(dir));

  const result = await findUsages(dir, "Handler");
  assert.equal(result.total, 1);
  assert.equal(result.matches[0]?.kind, "definition");
});

test("throws when auto-detection finds no language markers", async (t) => {
  const dir = await makeFixture({ "a.py": "class Handler:\n    pass\n" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(() => findUsages(dir, "Handler", "auto"), /could not auto-detect a language/);
});

test("throws when auto-detection finds markers for more than one language", async (t) => {
  const dir = await makeFixture({
    "App.sln": "",
    ".venv/pyvenv.cfg": "",
    "a.py": "class Handler:\n    pass\n",
  });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(() => findUsages(dir, "Handler", "auto"), /markers for multiple languages/);
});
