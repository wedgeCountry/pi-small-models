import { test } from "node:test";
import assert from "node:assert/strict";
import { build, type BuildDeps } from "../src/tools/build.ts";
import type { DotnetBuildResult } from "../src/tools/dotnet_build.ts";
import type { TsCheckResult } from "../src/tools/ts_check.ts";
import type { PyImportResult } from "../src/tools/py_import.ts";
import { makeFixture, cleanupFixture } from "./fixtures.ts";
import { Sandbox } from "../src/sandbox/sandbox.ts";

/** Mocks mirroring the real tools' representative results (see dotnet_build.ts / ts_check.ts / py_import.ts). */
function makeMockDeps(overrides: Partial<Record<keyof BuildDeps, Partial<{ success: boolean }>>> = {}): BuildDeps {
  const dotnetResult = (success: boolean): DotnetBuildResult => ({
    success,
    exitCode: success ? 0 : 1,
    output: success
      ? "MSBuild succeeded. 0 Warning(s)\n0 Error(s)"
      : "Program.cs(12,23): error CS0103: The name 'X' does not exist in the current context",
  });
  const tsResult = (success: boolean): TsCheckResult => ({
    success,
    exitCode: success ? 0 : 2,
    output: success
      ? "No type errors found."
      : "src/a.ts(3,7): error TS2322: Type 'string' is not assignable to type 'number'.",
  });
  const pyResult = (success: boolean): PyImportResult => ({
    success,
    checked: 3,
    failures: success
      ? []
      : [{ file: "bad.py", error: "ModuleNotFoundError: No module named 'missing_module_xyz'" }],
    output: success
      ? "All 3 Python file(s) imported successfully."
      : "1 of 3 Python file(s) failed to import:\nbad.py: ModuleNotFoundError: No module named 'missing_module_xyz'",
  });
  return {
    dotnetBuild: async () => dotnetResult(overrides.dotnetBuild?.success ?? true),
    tsCheck: async () => tsResult(overrides.tsCheck?.success ?? true),
    pyImport: async () => pyResult(overrides.pyImport?.success ?? true),
  };
}

test("skips all steps in a project with no dotnet/ts/python", async (t) => {
  const dir = await makeFixture({ "a.txt": "hello\n" });
  t.after(() => cleanupFixture(dir));

  const result = await build(new Sandbox(dir), { deps: makeMockDeps() });
  assert.equal(result.success, true);
  assert.equal(result.steps.length, 3);
  assert.ok(result.steps.every((s) => s.skipped));
});

test("runs py_import when python files are present", async (t) => {
  const dir = await makeFixture({ "a.py": "x = 1\n" });
  t.after(() => cleanupFixture(dir));

  const result = await build(new Sandbox(dir), { deps: makeMockDeps() });
  const pyStep = result.steps.find((s) => s.step === "py_import")!;
  assert.equal(pyStep.skipped, false);
  assert.equal(pyStep.success, true);
  assert.ok(pyStep.output.includes("3 Python file(s)"));
  assert.equal(result.success, true);
});

test("fails when a python file does not import", async (t) => {
  const dir = await makeFixture({ "bad.py": "import missing_module_xyz\n" });
  t.after(() => cleanupFixture(dir));

  const result = await build(new Sandbox(dir), { deps: makeMockDeps({ pyImport: { success: false } }) });
  assert.equal(result.success, false);
  const pyStep = result.steps.find((s) => s.step === "py_import")!;
  assert.equal(pyStep.success, false);
  assert.ok(result.output.includes("[py_import] ✗"));
  assert.ok(result.output.includes("bad.py"));
});

test("runs dotnet_build and ts_check when present, both passing", async (t) => {
  const dir = await makeFixture({
    "App.csproj": "<Project Sdk=\"Microsoft.NET.Sdk\" />\n",
    "tsconfig.json": "{}\n",
  });
  t.after(() => cleanupFixture(dir));

  const result = await build(new Sandbox(dir), { deps: makeMockDeps() });
  assert.equal(result.success, true);
  const dn = result.steps.find((s) => s.step === "dotnet_build")!;
  const ts = result.steps.find((s) => s.step === "ts_check")!;
  assert.equal(dn.skipped, false);
  assert.equal(ts.skipped, false);
  assert.ok(dn.output.includes("MSBuild succeeded"));
  assert.ok(ts.output.includes("No type errors found"));
});

test("propagates a failing dotnet build", async (t) => {
  const dir = await makeFixture({ "App.csproj": "<Project />\n" });
  t.after(() => cleanupFixture(dir));

  const result = await build(new Sandbox(dir), { deps: makeMockDeps({ dotnetBuild: { success: false } }) });
  assert.equal(result.success, false);
  assert.ok(result.output.includes("error CS0103"));
});

test("propagates failing type errors", async (t) => {
  const dir = await makeFixture({ "tsconfig.json": "{}\n" });
  t.after(() => cleanupFixture(dir));

  const result = await build(new Sandbox(dir), { deps: makeMockDeps({ tsCheck: { success: false } }) });
  assert.equal(result.success, false);
  assert.ok(result.output.includes("error TS2322"));
});

test("reports a non-existing path as failure", async (t) => {
  const dir = await makeFixture({ "a.py": "x = 1\n" });
  t.after(() => cleanupFixture(dir));

  const result = await build(new Sandbox(dir), { path: "missing-dir", deps: makeMockDeps() });
  assert.equal(result.success, false);
  assert.ok(result.output.includes("missing-dir"));
});

test("path option is validated against the sandbox", async (t) => {
  const dir = await makeFixture({ "a.py": "x = 1\n" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(() => build(new Sandbox(dir), { path: "../outside", deps: makeMockDeps() }));
});

test("rejects when the signal is already aborted", async (t) => {
  const dir = await makeFixture({ "a.py": "x = 1\n" });
  t.after(() => cleanupFixture(dir));

  const ac = new AbortController();
  ac.abort();
  await assert.rejects(() => build(new Sandbox(dir), { signal: ac.signal, deps: makeMockDeps() }));
});
