import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { uninstall, type UninstallDeps, type UninstallRunResult } from "../src/tools/uninstall.ts";
import { makeFixture, cleanupFixture } from "./fixtures.ts";
import { Sandbox } from "../src/sandbox/sandbox.ts";

/** Mocks mirroring the real uninstall commands and the requirements.txt editor. */
function makeMockDeps(overrides: { installResult?: Partial<UninstallRunResult> } = {}): UninstallDeps {
  const uninstallCalls: { language: string; args: string[] }[] = [];
  const deps: UninstallDeps = {
    runUninstall: async (language, args): Promise<UninstallRunResult> => {
      uninstallCalls.push({ language, args });
      return { success: true, output: `removed ${args.join(" ")}`, ...overrides.installResult };
    },
    removeRequirement: async () => "Removed requests from requirements.txt",
  };
  (deps as UninstallDeps & { uninstallCalls: typeof uninstallCalls }).uninstallCalls = uninstallCalls;
  return deps;
}

function withCalls(deps: UninstallDeps) {
  return deps as UninstallDeps & { uninstallCalls: { language: string; args: string[] }[] };
}

test("npm uninstall uses npm uninstall with the plain name", async (t) => {
  const dir = await makeFixture({ "package.json": "{}" });
  t.after(() => cleanupFixture(dir));

  const deps = makeMockDeps();
  const result = await uninstall(new Sandbox(dir), { package: "left-pad", language: "typescript", deps });
  assert.equal(result.success, true);
  const call = withCalls(deps).uninstallCalls[0]!;
  assert.equal(call.language, "typescript");
  assert.deepEqual(call.args, ["uninstall", "left-pad"]);
});

test("pip uninstall runs pip and notes the requirements.txt change", async (t) => {
  const dir = await makeFixture({ "a.py": "x = 1\n", "requirements.txt": "requests==2.31.0\n" });
  t.after(() => cleanupFixture(dir));

  const deps = makeMockDeps();
  const result = await uninstall(new Sandbox(dir), { package: "requests", language: "python", deps });
  assert.equal(result.success, true);
  const call = withCalls(deps).uninstallCalls[0]!;
  assert.equal(call.language, "python");
  assert.ok(call.args.includes("uninstall"));
  assert.ok(call.args.includes("--yes"));
  assert.ok(result.output.includes("Removed requests from requirements.txt"));
});

test("dotnet remove package targets the single project", async (t) => {
  const dir = await makeFixture({ "App.csproj": "<Project />\n" });
  t.after(() => cleanupFixture(dir));

  const deps = makeMockDeps();
  const result = await uninstall(new Sandbox(dir), { package: "Serilog", language: "dotnet", deps });
  assert.equal(result.success, true);
  const call = withCalls(deps).uninstallCalls[0]!;
  assert.equal(call.language, "dotnet");
  assert.equal(call.args[0], "remove");
  assert.equal(call.args[1], "package");
  assert.equal(call.args[2], "Serilog");
  assert.ok(call.args.includes("App.csproj"));
});

test("auto-detects the language from the project", async (t) => {
  const dir = await makeFixture({ "a.py": "x = 1\n" });
  t.after(() => cleanupFixture(dir));

  const result = await uninstall(new Sandbox(dir), { package: "requests", deps: makeMockDeps() });
  assert.equal(result.language, "python");
});

test("asks to pin the language when several are detected", async (t) => {
  const dir = await makeFixture({ "package.json": "{}", "a.py": "x = 1\n" });
  t.after(() => cleanupFixture(dir));

  const result = await uninstall(new Sandbox(dir), { package: "x", deps: makeMockDeps() });
  assert.equal(result.success, false);
  assert.ok(result.output.includes("language="));
});

test("reports when no language is detected", async (t) => {
  const dir = await makeFixture({ "a.txt": "" });
  t.after(() => cleanupFixture(dir));

  const result = await uninstall(new Sandbox(dir), { package: "x", deps: makeMockDeps() });
  assert.equal(result.success, false);
  assert.ok(result.output.includes("language="));
});

test("rejects local files and URLs like install does", async (t) => {
  const dir = await makeFixture({ "package.json": "{}" });
  t.after(() => cleanupFixture(dir));

  for (const bad of ["pkg-1.0.0-py3-none-any.whl", "./pkg.tgz", "git+https://github.com/x/y.git", "pkg; rm -rf /"]) {
    await assert.rejects(
      () => uninstall(new Sandbox(dir), { package: bad, language: "typescript", deps: makeMockDeps() }),
      /local package file|not an official registry package name|not allowed in a package name/
    );
  }
});

test("rejects when the signal is already aborted", async (t) => {
  const dir = await makeFixture({ "package.json": "{}" });
  t.after(() => cleanupFixture(dir));

  const ac = new AbortController();
  ac.abort();
  await assert.rejects(() =>
    uninstall(new Sandbox(dir), { package: "x", language: "typescript", signal: ac.signal, deps: makeMockDeps() })
  );
});

test("requirements.txt is actually updated by the real helper (integration)", async (t) => {
  const dir = await makeFixture({
    "a.py": "x = 1\n",
    "requirements.txt": "requests==2.31.0\nflask==3.0.0\n",
  });
  t.after(() => cleanupFixture(dir));

  // No deps injected: runUninstall mocked, removeRequirement real.
  const deps: UninstallDeps = {
    runUninstall: async () => ({ success: true, output: "Successfully uninstalled requests" }),
    removeRequirement: (await import("../src/tools/requirementsManifest.ts")).removeRequirement,
  };
  const result = await uninstall(new Sandbox(dir), { package: "requests", language: "python", deps });
  assert.equal(result.success, true);
  const content = await fs.readFile(path.join(dir, "requirements.txt"), "utf8");
  assert.ok(!content.includes("requests"));
  assert.ok(content.includes("flask==3.0.0"));
});
