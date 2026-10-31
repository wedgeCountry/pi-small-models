import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { libInfo, type LibInfoDeps, type LibInfoResult } from "../src/tools/lib_info.ts";
import type { LibExtraction } from "../src/tools/libInfo/types.ts";
import { makeFixture, cleanupFixture } from "./fixtures.ts";
import { Sandbox } from "../src/sandbox/sandbox.ts";

/**
 * Mock extractors mirroring the real ones' representative structure (see libInfo/types.ts):
 * a small LibExtraction that format.ts renders into the overview / search / symbol views.
 */
function mockExtraction(name: string, symbols: string[]): LibExtraction {
  return {
    info: {
      ecosystem: "npm",
      name,
      version: "1.2.3",
      location: `node_modules/${name}`,
    },
    rootContainer: "",
    entries: symbols.map((s) => ({
      kind: s === "Counter" ? "class" : "function",
      name: s,
      container: "",
      signature: s === "Counter" ? `class ${s}` : `function ${s}(name: string): string`,
      docs: `Docs for ${s}.`,
    })),
  } satisfies LibExtraction;
}

function makeMockDeps(symbolsByLanguage: Partial<Record<"ts" | "py" | "dotnet", string[]>> = {}): LibInfoDeps {
  return {
    extractTsLibrary: async (_sb, pkg) => {
      if (!symbolsByLanguage.ts) throw new Error(`Package "${pkg}" is not installed`);
      return mockExtraction(pkg, symbolsByLanguage.ts);
    },
    extractPyLibrary: async (_sb, pkg) => {
      if (!symbolsByLanguage.py) throw new Error(`Package "${pkg}" is not installed`);
      return mockExtraction(pkg, symbolsByLanguage.py);
    },
    extractDotnetLibrary: async (_sb, pkg) => {
      if (!symbolsByLanguage.dotnet) throw new Error(`${pkg} 1.0.0 is referenced but not found in the package folders`);
      return mockExtraction(pkg, symbolsByLanguage.dotnet);
    },
  };
}

async function installFakeNpmPackage(dir: string, pkg: string) {
  const pkgDir = path.join(dir, "node_modules", pkg);
  await mkdir(pkgDir, { recursive: true });
  await writeFile(path.join(pkgDir, "package.json"), JSON.stringify({ name: pkg, version: "1.0.0" }), "utf8");
}

test("auto-detects typescript when the package is in node_modules", async (t) => {
  const dir = await makeFixture({});
  t.after(() => cleanupFixture(dir));
  await installFakeNpmPackage(dir, "fake-lib");

  const result = await libInfo(new Sandbox(dir), "fake-lib", {
    deps: makeMockDeps({ ts: ["greet", "Counter"] }),
  });
  assert.equal(result.language, "typescript");
  assert.ok(result.text.includes("greet"));
  assert.ok(result.text.includes("Counter"));
  assert.ok(result.text.includes("fake-lib"));
});

test("falls back to python when the package is not in node_modules", async (t) => {
  const dir = await makeFixture({});
  t.after(() => cleanupFixture(dir));

  const result = await libInfo(new Sandbox(dir), "py-only", {
    deps: makeMockDeps({ py: ["run", "stop"] }),
  });
  assert.equal(result.language, "python");
  assert.ok(result.text.includes("run"));
});

test("falls back to dotnet when ts and python miss", async (t) => {
  const dir = await makeFixture({});
  t.after(() => cleanupFixture(dir));

  const result = await libInfo(new Sandbox(dir), "Nuget.Only", {
    deps: makeMockDeps({ dotnet: ["Serialize", "Deserialize"] }),
  });
  assert.equal(result.language, "dotnet");
  assert.ok(result.text.includes("Serialize"));
});

test("language option pins the language and skips others", async (t) => {
  const dir = await makeFixture({});
  t.after(() => cleanupFixture(dir));
  await installFakeNpmPackage(dir, "fake-lib");

  const result = await libInfo(new Sandbox(dir), "fake-lib", {
    language: "typescript",
    deps: makeMockDeps({ ts: ["greet"] }),
  });
  assert.equal(result.language, "typescript");

  await assert.rejects(
    () =>
      libInfo(new Sandbox(dir), "fake-lib", {
        language: "python",
        deps: makeMockDeps({ ts: ["greet"] }),
      }),
    /Could not find package "fake-lib"/
  );
});

test("aggregates all languages' errors when nothing is found", async (t) => {
  const dir = await makeFixture({});
  t.after(() => cleanupFixture(dir));

  await assert.rejects(
    () => libInfo(new Sandbox(dir), "nowhere", { deps: makeMockDeps() }),
    (err: Error) => {
      assert.match(err.message, /Could not find package "nowhere"/);
      assert.match(err.message, /typescript: package "nowhere" is not installed/);
      assert.match(err.message, /python: Package "nowhere" is not installed/);
      assert.match(err.message, /dotnet: nowhere 1\.0\.0 is referenced but not found/);
      return true;
    }
  );
});

test("query option is forwarded to the renderer", async (t) => {
  const dir = await makeFixture({});
  t.after(() => cleanupFixture(dir));
  await installFakeNpmPackage(dir, "fake-lib");

  const result = await libInfo(new Sandbox(dir), "fake-lib", {
    query: "greet",
    deps: makeMockDeps({ ts: ["greet", "other"] }),
  });
  assert.equal(result.language, "typescript");
  assert.ok(result.text.includes("greet"));
});

test("rejects when the signal is already aborted", async (t) => {
  const dir = await makeFixture({});
  t.after(() => cleanupFixture(dir));

  const ac = new AbortController();
  ac.abort();
  await assert.rejects(() =>
    libInfo(new Sandbox(dir), "x", { signal: ac.signal, deps: makeMockDeps({ ts: ["a"] }) })
  );
});

test("mock result type matches LibInfoResult shape", async (t) => {
  const dir = await makeFixture({});
  t.after(() => cleanupFixture(dir));
  await installFakeNpmPackage(dir, "fake-lib");

  const result: LibInfoResult = await libInfo(new Sandbox(dir), "fake-lib", {
    deps: makeMockDeps({ ts: ["greet"] }),
  });
  assert.equal(typeof result.text, "string");
  assert.ok(["overview", "search", "symbol"].includes(result.view));
  assert.equal(typeof result.truncated, "boolean");
});
