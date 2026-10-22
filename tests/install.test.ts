import { test } from "node:test";
import assert from "node:assert/strict";
import { install, type InstallDeps, type RegistryInfo, type InstallRunResult } from "../src/tools/install.ts";
import { makeFixture, cleanupFixture } from "./fixtures.ts";
import { Sandbox } from "../src/sandbox/sandbox.ts";

/** Mocks mirroring the real registry lookups and install commands. */
function makeMockDeps(overrides: {
  registry?: Partial<Record<"typescript" | "python" | "dotnet", RegistryInfo>>;
  installResult?: Partial<InstallRunResult>;
} = {}): InstallDeps {
  const lookupCalls: { language: string; name: string }[] = [];
  const installCalls: { language: string; args: string[] }[] = [];
  const deps: InstallDeps = {
    registryLookup: async (language, name) => {
      lookupCalls.push({ language, name });
      return overrides.registry?.[language] ?? { exists: true, versions: undefined };
    },
    runInstall: async (language, args): Promise<InstallRunResult> => {
      installCalls.push({ language, args });
      return { success: true, output: `+ ${args.join(" ")}`, ...overrides.installResult };
    },
    fetchJson: async () => undefined,
    addRequirement: async () => "Added to requirements.txt",
  };
  (deps as InstallDeps & { lookupCalls: typeof lookupCalls; installCalls: typeof installCalls }).lookupCalls = lookupCalls;
  (deps as InstallDeps & { lookupCalls: typeof lookupCalls; installCalls: typeof installCalls }).installCalls = installCalls;
  return deps;
}

function withCalls(deps: InstallDeps) {
  return deps as InstallDeps & { lookupCalls: { language: string; name: string }[]; installCalls: { language: string; args: string[] }[] };
}

test("rejects local files (wheel) without any lookup or install", async (t) => {
  const dir = await makeFixture({ "requirements.txt": "" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(
    () => install(new Sandbox(dir), { package: "pkg-1.0.0-py3-none-any.whl", language: "python", deps: makeMockDeps() }),
    /local package file|not a valid PyPI package name/
  );
});

test("rejects local tarballs and file: specs", async (t) => {
  const dir = await makeFixture({ "package.json": "{}" });
  t.after(() => cleanupFixture(dir));

  for (const bad of ["./pkg.tgz", "file:../pkg", "/tmp/pkg.tar.gz"]) {
    await assert.rejects(
      () => install(new Sandbox(dir), { package: bad, language: "typescript", deps: makeMockDeps() }),
      /local package file|not an official registry package name/
    );
  }
});

test("rejects git and http URLs", async (t) => {
  const dir = await makeFixture({ "package.json": "{}" });
  t.after(() => cleanupFixture(dir));

  for (const bad of ["git+https://github.com/x/y.git", "https://evil.example.com/pkg", "github:user/repo"]) {
    await assert.rejects(
      () => install(new Sandbox(dir), { package: bad, language: "typescript", deps: makeMockDeps() }),
      (err: Error) => /not an official registry package name|not a valid/.test(err.message)
    );
  }
});

test("rejects shell metacharacters in the name", async (t) => {
  const dir = await makeFixture({ "package.json": "{}" });
  t.after(() => cleanupFixture(dir));

  for (const bad of ["pkg; rm -rf /", "pkg && curl", "$(whoami)", "pkg`id`", "a|b"]) {
    await assert.rejects(
      () => install(new Sandbox(dir), { package: bad, language: "typescript", deps: makeMockDeps() }),
      /not allowed in a package name|not a valid/
    );
  }
});

test("rejects a name the registry does not know", async (t) => {
  const dir = await makeFixture({ "package.json": "{}" });
  t.after(() => cleanupFixture(dir));

  const result = await install(new Sandbox(dir), {
    package: "typosquat-not-real",
    language: "typescript",
    deps: makeMockDeps({ registry: { typescript: { exists: false } } }),
  });
  assert.equal(result.success, false);
  assert.ok(result.output.includes("not registered on npm"));
});

test("rejects a version the registry does not list", async (t) => {
  const dir = await makeFixture({ "package.json": "{}" });
  t.after(() => cleanupFixture(dir));

  const result = await install(new Sandbox(dir), {
    package: "react",
    version: "99.99.99",
    language: "typescript",
    deps: makeMockDeps({ registry: { typescript: { exists: true, versions: ["18.0.0", "18.1.0"] } } }),
  });
  assert.equal(result.success, false);
  assert.ok(result.output.includes("99.99.99"));
  assert.ok(result.output.includes("18.1.0"));
});

test("installs an npm package with --ignore-scripts", async (t) => {
  const dir = await makeFixture({ "package.json": "{}" });
  t.after(() => cleanupFixture(dir));

  const deps = makeMockDeps();
  const result = await install(new Sandbox(dir), { package: "left-pad", version: "2.0.0", language: "typescript", deps });
  assert.equal(result.success, true);
  const call = withCalls(deps).installCalls[0]!;
  assert.equal(call.language, "typescript");
  assert.deepEqual(call.args, ["install", "left-pad@2.0.0", "--ignore-scripts"]);
});

test("npm dev dependency adds --save-dev", async (t) => {
  const dir = await makeFixture({ "package.json": "{}" });
  t.after(() => cleanupFixture(dir));

  const deps = makeMockDeps();
  await install(new Sandbox(dir), { package: "left-pad", language: "typescript", dev: true, deps });
  const call = withCalls(deps).installCalls[0]!;
  assert.ok(call.args.includes("--save-dev"));
  assert.ok(call.args.includes("--ignore-scripts"));
});

test("npm native-compilation failure explains the manual rebuild", async (t) => {
  const dir = await makeFixture({ "package.json": "{}" });
  t.after(() => cleanupFixture(dir));

  const result = await install(new Sandbox(dir), {
    package: "sqlite3",
    language: "typescript",
    deps: makeMockDeps({ installResult: { success: false, output: "gyp ERR! build error\nnode-gyp failed" } }),
  });
  assert.equal(result.success, false);
  assert.ok(result.output.includes("npm rebuild"));
  assert.ok(result.output.includes("--build-from-source"));
});

test("installs a pip package into the project interpreter as exact version", async (t) => {
  const dir = await makeFixture({ "a.py": "x = 1\n" });
  t.after(() => cleanupFixture(dir));

  const deps = makeMockDeps();
  const result = await install(new Sandbox(dir), { package: "requests", version: "2.31.0", language: "python", deps });
  assert.equal(result.success, true);
  const call = withCalls(deps).installCalls[0]!;
  assert.equal(call.language, "python");
  assert.ok(call.args.includes("requests==2.31.0"));
});

test("installs a nuget package with an exact version", async (t) => {
  const dir = await makeFixture({ "App.csproj": "<Project />\n" });
  t.after(() => cleanupFixture(dir));

  const deps = makeMockDeps();
  const result = await install(new Sandbox(dir), { package: "Serilog", version: "3.1.1", language: "dotnet", deps });
  assert.equal(result.success, true);
  const call = withCalls(deps).installCalls[0]!;
  assert.equal(call.language, "dotnet");
  assert.ok(call.args.includes("add"));
  assert.ok(call.args.includes("package"));
  assert.equal(call.args[2], "Serilog");
  assert.ok(call.args.includes("3.1.1"));
});

test("auto-detects a single language from the project", async (t) => {
  const dir = await makeFixture({ "a.py": "x = 1\n" });
  t.after(() => cleanupFixture(dir));

  const deps = makeMockDeps();
  const result = await install(new Sandbox(dir), { package: "requests", deps });
  assert.equal(result.language, "python");
});

test("asks to pin the language when several are detected", async (t) => {
  const dir = await makeFixture({ "package.json": "{}", "a.py": "x = 1\n" });
  t.after(() => cleanupFixture(dir));

  const result = await install(new Sandbox(dir), { package: "x", deps: makeMockDeps() });
  assert.equal(result.success, false);
  assert.ok(result.output.includes("language="));
});

test("reports when no language is detected", async (t) => {
  const dir = await makeFixture({ "a.txt": "" });
  t.after(() => cleanupFixture(dir));

  const result = await install(new Sandbox(dir), { package: "x", deps: makeMockDeps() });
  assert.equal(result.success, false);
  assert.ok(result.output.includes("language="));
});

test("rejects a bad version specifier", async (t) => {
  const dir = await makeFixture({ "package.json": "{}" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(
    () => install(new Sandbox(dir), { package: "x", version: "1.0 && rm", language: "typescript", deps: makeMockDeps() }),
    /not a valid version specifier/
  );
});

test("rejects when the signal is already aborted", async (t) => {
  const dir = await makeFixture({ "package.json": "{}" });
  t.after(() => cleanupFixture(dir));

  const ac = new AbortController();
  ac.abort();
  await assert.rejects(() =>
    install(new Sandbox(dir), { package: "x", language: "typescript", signal: ac.signal, deps: makeMockDeps() })
  );
});

test("pip install updates requirements.txt (integration with the real helper)", async (t) => {
  const dir = await makeFixture({
    "a.py": "x = 1\n",
    "requirements.txt": "flask==3.0.0\n",
  });
  t.after(() => cleanupFixture(dir));

  const { addRequirement } = await import("../src/tools/requirementsManifest.ts");
  const deps = makeMockDeps();
  (deps as InstallDeps & { addRequirement: typeof addRequirement }).addRequirement = addRequirement;
  const result = await install(new Sandbox(dir), {
    package: "requests",
    version: "2.31.0",
    language: "python",
    deps,
  });
  assert.equal(result.success, true);
  assert.ok(result.output.includes("requirements.txt"));
  const content = await (await import("node:fs/promises")).readFile(
    (await import("node:path")).join(dir, "requirements.txt"),
    "utf8"
  );
  assert.ok(content.includes("requests==2.31.0"));
  assert.ok(content.includes("flask==3.0.0"));
});
