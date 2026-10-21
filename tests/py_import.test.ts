import { test } from "node:test";
import assert from "node:assert/strict";
import { pyImport } from "../src/tools/py_import.ts";
import { makeFixture, cleanupFixture } from "./fixtures.ts";
import { Sandbox } from "../src/sandbox/sandbox.ts";

test("passes when all python files import cleanly", async (t) => {
  const dir = await makeFixture({
    "a.py": "x = 1\n",
    "pkg/b.py": "from pathlib import Path\ny = Path('.')\n",
  });
  t.after(() => cleanupFixture(dir));

  const result = await pyImport(new Sandbox(dir));
  assert.equal(result.success, true);
  assert.equal(result.checked, 2);
  assert.equal(result.failures.length, 0);
});

test("fails when one file has a syntax error", async (t) => {
  const dir = await makeFixture({
    "good.py": "x = 1\n",
    "bad.py": "def broken(:\n",
  });
  t.after(() => cleanupFixture(dir));

  const result = await pyImport(new Sandbox(dir));
  assert.equal(result.success, false);
  assert.equal(result.checked, 2);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0]!.file, "bad.py");
  assert.ok(result.output.includes("bad.py"));
});

test("fails when a top-level import is missing", async (t) => {
  const dir = await makeFixture({
    "needs_missing.py": "import package_that_does_not_exist_xyz\n",
  });
  t.after(() => cleanupFixture(dir));

  const result = await pyImport(new Sandbox(dir));
  assert.equal(result.success, false);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0]!.file, "needs_missing.py");
  assert.ok(result.output.includes("ModuleNotFoundError"));
});

test("resolves sibling imports within the same directory", async (t) => {
  const dir = await makeFixture({
    "lib.py": "VALUE = 42\n",
    "app.py": "from lib import VALUE\nassert VALUE == 42\n",
  });
  t.after(() => cleanupFixture(dir));

  const result = await pyImport(new Sandbox(dir));
  assert.equal(result.success, true);
});

test("checks a subdirectory via path option", async (t) => {
  const dir = await makeFixture({
    "outside.py": "import missing_module_xyz\n",
    "sub/inside.py": "ok = True\n",
  });
  t.after(() => cleanupFixture(dir));

  const result = await pyImport(new Sandbox(dir), { path: "sub" });
  assert.equal(result.success, true);
  assert.equal(result.checked, 1);
});

test("path option is validated against the sandbox", async (t) => {
  const dir = await makeFixture({ "a.py": "x = 1\n" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(() => pyImport(new Sandbox(dir), { path: "../outside" }));
});

test("handles a directory with no python files", async (t) => {
  const dir = await makeFixture({ "a.txt": "hello\n" });
  t.after(() => cleanupFixture(dir));

  const result = await pyImport(new Sandbox(dir));
  assert.equal(result.success, true);
  assert.equal(result.checked, 0);
});

test("rejects when the signal is already aborted", async (t) => {
  const dir = await makeFixture({ "a.py": "x = 1\n" });
  t.after(() => cleanupFixture(dir));

  const ac = new AbortController();
  ac.abort();
  await assert.rejects(() => pyImport(new Sandbox(dir), { signal: ac.signal }));
});
