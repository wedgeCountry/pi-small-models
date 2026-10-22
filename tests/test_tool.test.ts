import { test } from "node:test";
import assert from "node:assert/strict";
import { testProject, type CommandRun, type TestDeps } from "../src/tools/test.ts";
import { makeFixture, cleanupFixture } from "./fixtures.ts";
import { Sandbox } from "../src/sandbox/sandbox.ts";

/** Mocks mirroring representative real runner output (dotnet test / npm test / pytest). */
function makeMockDeps(overrides: Partial<Record<keyof TestDeps, Partial<{ success: boolean }>>> = {}): TestDeps {
  const run = (success: boolean, output: string): CommandRun => ({ success, output, notInstalled: false });
  return {
    dotnetTest: async () =>
      overrides.dotnetTest?.success === false
        ? run(false, "Failed! - Failed: 1, Passed: 4, Skipped: 0, Total: 5")
        : run(true, "Passed! - Failed: 0, Passed: 5, Skipped: 0, Total: 5"),
    npmTest: async () =>
      overrides.npmTest?.success === false
        ? run(false, "npm ERR! Test failed. 1 failing\n  ✗ example fails")
        : run(true, "PASS tests/a.test.ts\nTests: 2 passed, 2 total"),
    pytest: async () =>
      overrides.pytest?.success === false
        ? run(false, "1 failed, 2 passed in 0.05s\nFAILED tests/test_x.py::test_bad - assert False")
        : run(true, "3 passed in 0.05s"),
  };
}

test("skips all steps in a project with no tests", async (t) => {
  const dir = await makeFixture({ "a.txt": "hello\n" });
  t.after(() => cleanupFixture(dir));

  const result = await testProject(new Sandbox(dir), { deps: makeMockDeps() });
  assert.equal(result.success, true);
  assert.equal(result.steps.length, 3);
  assert.ok(result.steps.every((s) => s.skipped));
});

test("runs npm test when a package.json test script exists", async (t) => {
  const dir = await makeFixture({
    "package.json": JSON.stringify({ name: "x", scripts: { test: "node --test" } }),
  });
  t.after(() => cleanupFixture(dir));

  const result = await testProject(new Sandbox(dir), { deps: makeMockDeps() });
  const npmStep = result.steps.find((s) => s.step === "npm_test")!;
  assert.equal(npmStep.skipped, false);
  assert.equal(npmStep.success, true);
  assert.ok(npmStep.output.includes("Tests: 2 passed"));
  assert.equal(result.success, true);
});

test("fails when npm test fails", async (t) => {
  const dir = await makeFixture({
    "package.json": JSON.stringify({ name: "x", scripts: { test: "node --test" } }),
  });
  t.after(() => cleanupFixture(dir));

  const result = await testProject(new Sandbox(dir), { deps: makeMockDeps({ npmTest: { success: false } }) });
  assert.equal(result.success, false);
  const npmStep = result.steps.find((s) => s.step === "npm_test")!;
  assert.equal(npmStep.success, false);
  assert.ok(result.output.includes("1 failing"));
});

test("skips npm when package.json has no test script", async (t) => {
  const dir = await makeFixture({
    "package.json": JSON.stringify({ name: "x", scripts: { build: "echo b" } }),
  });
  t.after(() => cleanupFixture(dir));

  const result = await testProject(new Sandbox(dir), { deps: makeMockDeps() });
  const npmStep = result.steps.find((s) => s.step === "npm_test")!;
  assert.equal(npmStep.skipped, true);
});

test("runs pytest when python test files are present", async (t) => {
  const dir = await makeFixture({ "test_sample.py": "def test_ok():\n    assert True\n" });
  t.after(() => cleanupFixture(dir));

  const result = await testProject(new Sandbox(dir), { deps: makeMockDeps() });
  const pyStep = result.steps.find((s) => s.step === "pytest")!;
  assert.equal(pyStep.skipped, false);
  assert.equal(pyStep.success, true);
  assert.ok(pyStep.output.includes("3 passed"));
});

test("propagates a pytest failure", async (t) => {
  const dir = await makeFixture({ "test_sample.py": "def test_ok():\n    assert False\n" });
  t.after(() => cleanupFixture(dir));

  const result = await testProject(new Sandbox(dir), { deps: makeMockDeps({ pytest: { success: false } }) });
  assert.equal(result.success, false);
  assert.ok(result.output.includes("FAILED tests/test_x.py::test_bad"));
});

test("runs dotnet test when a project is present", async (t) => {
  const dir = await makeFixture({ "App.csproj": "<Project />\n" });
  t.after(() => cleanupFixture(dir));

  const result = await testProject(new Sandbox(dir), { deps: makeMockDeps() });
  const dnStep = result.steps.find((s) => s.step === "dotnet_test")!;
  assert.equal(dnStep.skipped, false);
  assert.equal(dnStep.success, true);
  assert.ok(dnStep.output.includes("Passed!"));
});

test("reports a non-existing path as failure", async (t) => {
  const dir = await makeFixture({ "a.py": "x = 1\n" });
  t.after(() => cleanupFixture(dir));

  const result = await testProject(new Sandbox(dir), { path: "missing-dir", deps: makeMockDeps() });
  assert.equal(result.success, false);
  assert.ok(result.output.includes("missing-dir"));
});

test("path option is validated against the sandbox", async (t) => {
  const dir = await makeFixture({ "a.py": "x = 1\n" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(() => testProject(new Sandbox(dir), { path: "../outside", deps: makeMockDeps() }));
});

test("rejects when the signal is already aborted", async (t) => {
  const dir = await makeFixture({ "a.py": "x = 1\n" });
  t.after(() => cleanupFixture(dir));

  const ac = new AbortController();
  ac.abort();
  await assert.rejects(() => testProject(new Sandbox(dir), { signal: ac.signal, deps: makeMockDeps() }));
});
