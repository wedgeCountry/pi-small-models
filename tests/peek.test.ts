import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { peekFile, renderPeekResult } from "../src/tools/peek.ts";
import { PEEK_EXTENSIONS, previewManagerFor } from "../src/tools/previewManagers/registry.ts";
import { describeToolCall } from "../src/sandbox/permissionGate.ts";
import { makeFixture, cleanupFixture } from "./fixtures.ts";
import { Sandbox } from "../src/sandbox/sandbox.ts";

const PY = `class Api:
    def get(self, id: int) -> str:
        return str(id)

    def _cache(self):
        pass

def __mangled():
    pass
`;

test("selects the PreviewManager by file extension (case-insensitive)", () => {
  assert.equal(previewManagerFor(".py")?.language, "python");
  assert.equal(previewManagerFor(".PY")?.language, "python");
  assert.equal(previewManagerFor(".tsx")?.language, "typescript");
  assert.equal(previewManagerFor(".mjs")?.language, "typescript");
  assert.equal(previewManagerFor(".cs")?.language, "csharp");
  assert.equal(previewManagerFor(".md")?.language, "markdown");
  assert.equal(previewManagerFor(".json"), undefined);
  for (const ext of [".py", ".ts", ".cs", ".md"]) assert.ok(PEEK_EXTENSIONS.includes(ext));
});

test("called with only a path: public overview with line numbers, no bodies", async (t) => {
  const dir = await makeFixture({ "api.py": PY });
  t.after(() => cleanupFixture(dir));

  const result = await peekFile(new Sandbox(dir), "api.py");
  assert.equal(result.language, "python");
  assert.deepEqual(result.lines, [
    { line: 1, text: "class Api:" },
    { line: 2, text: "    def get(self, id: int) -> str:" },
  ]);
  assert.equal(result.totalLines, 10);
  assert.equal(result.truncated, false);
});

test("visibility is inclusive: protected adds _names, private shows everything", async (t) => {
  const dir = await makeFixture({ "api.py": PY });
  t.after(() => cleanupFixture(dir));
  const prot = await peekFile(new Sandbox(dir), "api.py", { visibility: "protected" });
  assert.deepEqual(prot.lines.map((l) => l.line), [1, 2, 5]);

  const priv = await peekFile(new Sandbox(dir), "api.py", { visibility: "private" });
  assert.deepEqual(priv.lines.map((l) => l.line), [1, 2, 5, 8]);
});

test("rejects unsupported extensions with a hint to use read", async (t) => {
  const dir = await makeFixture({ "data.json": "{}" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(peekFile(new Sandbox(dir), "data.json"), /does not support "\.json".*Use read/s);
});

test("rejects directories, missing files and binary files", async (t) => {
  const dir = await makeFixture({ "pkg.py/x.py": "def f(): pass", "bin.py": "def f():\0" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(peekFile(new Sandbox(dir), "pkg.py"), /Could not read file.*EISDIR/);
  await assert.rejects(peekFile(new Sandbox(dir), "missing.py"), /Could not read file.*ENOENT/);
  await assert.rejects(peekFile(new Sandbox(dir), "bin.py"), /binary/);
});

test("rejects an out-of-range maxDepth", async (t) => {
  const dir = await makeFixture({ "a.md": "# A" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(peekFile(new Sandbox(dir), "a.md", { maxDepth: 0 }), /maxDepth/);
  await assert.rejects(peekFile(new Sandbox(dir), "a.md", { maxDepth: 7 }), /maxDepth/);
});

test("caps the outline at 2000 lines and reports truncation", async (t) => {
  const source = Array.from({ length: 2500 }, (_, i) => `def f${i}(): pass`).join("\n");
  const dir = await makeFixture({ "many.py": source });
  t.after(() => cleanupFixture(dir));

  const result = await peekFile(new Sandbox(dir), "many.py");
  assert.equal(result.lines.length, 2000);
  assert.equal(result.truncated, true);
  assert.match(renderPeekResult("many.py", result, "public"), /Use read with offset=2001/);
});

test("renders line:text like read, and explains an empty result", async (t) => {
  const dir = await makeFixture({ "api.py": PY, "only_private.py": "def _x():\n    pass\n" });
  t.after(() => cleanupFixture(dir));

  const result = await peekFile(new Sandbox(dir), "api.py");
  assert.equal(renderPeekResult("api.py", result, "public"), "1:class Api:\n2:    def get(self, id: int) -> str:");

  const empty = await peekFile(new Sandbox(dir), "only_private.py");
  assert.match(renderPeekResult("only_private.py", empty, "public"), /No public declarations found.*visibility: "private"/);
});

test("honors an already-aborted signal", async (t) => {
  const dir = await makeFixture({ "api.py": PY });
  t.after(() => cleanupFixture(dir));

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(peekFile(new Sandbox(dir), "api.py", { signal: controller.signal }), { name: "AbortError" });
});

test("permission gate describes peek calls", () => {
  assert.equal(describeToolCall("peek", { path: "src/a.ts" }), "peek src/a.ts");
});

// --- Sandboxing: peek reads only through read's readFile, so it inherits read's sandbox checks.

test("sandbox: refuses paths outside the project root", async (t) => {
  const outside = await makeFixture({ "secret.py": "def leak(): pass" });
  const dir = await makeFixture({ "a.py": "def f(): pass" });
  t.after(() => Promise.all([cleanupFixture(dir), cleanupFixture(outside)]));

  const rel = path.relative(dir, path.join(outside, "secret.py"));
  await assert.rejects(peekFile(new Sandbox(dir), rel), /outside the project root/);
  await assert.rejects(peekFile(new Sandbox(dir), path.join(outside, "secret.py")), /outside the project root/);
});

test("sandbox: refuses restricted paths such as .git/**, same as read", async (t) => {
  const dir = await makeFixture({ ".git/hooks/hook.py": "def run(): pass" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(peekFile(new Sandbox(dir), ".git/hooks/hook.py"), /restricted by the sandbox/);
});

test("sandbox: refuses an in-root symlink pointing outside the root", async (t) => {
  const outside = await makeFixture({ "secret.py": "def leak(): pass" });
  const dir = await makeFixture({});
  t.after(() => Promise.all([cleanupFixture(dir), cleanupFixture(outside)]));
  try {
    await fs.symlink(path.join(outside, "secret.py"), path.join(dir, "link.py"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EPERM") return t.skip("symlinks not permitted");
    throw err;
  }

  await assert.rejects(peekFile(new Sandbox(dir), "link.py"), /outside the project root/);
});

test("sandbox: with the sandbox off, peek follows read's off behavior", async (t) => {
  const outside = await makeFixture({ "lib.py": "def shared(): pass" });
  const dir = await makeFixture({});
  t.after(() => Promise.all([cleanupFixture(dir), cleanupFixture(outside)]));

  const result = await peekFile(new Sandbox(dir, false), path.join(outside, "lib.py"));
  assert.deepEqual(result.lines, [{ line: 1, text: "def shared():" }]);
});
