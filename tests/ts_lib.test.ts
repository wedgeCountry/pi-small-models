import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tsLib } from "../src/tools/ts_lib.ts";
import { extractTsLibrary, moduleSpecifier } from "../src/tools/libInfo/typescriptLib.ts";
import { makeFixture, cleanupFixture } from "./fixtures.ts";
import { Sandbox } from "../src/sandbox/sandbox.ts";

const pkgJson = (o: object) => JSON.stringify(o);

const TYPED_PKG = {
  "package.json": pkgJson({ name: "app", version: "0.0.0" }),
  "node_modules/typed-lib/package.json": pkgJson({
    name: "typed-lib",
    version: "2.1.0",
    description: "A typed test library",
    dependencies: { "dep-a": "^1.0.0" },
    exports: {
      ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
      "./extra": { types: "./dist/extra.d.ts", import: "./dist/extra.js" },
      "./package.json": "./package.json",
    },
  }),
  "node_modules/typed-lib/dist/index.d.ts": [
    'export * from "./client";',
    'export { helper as renamedHelper } from "./helpers";',
    "/** Adds numbers. */",
    "export declare function add(a: number, b: number): number;",
    "/** Adds strings. */",
    "export declare function add(a: string, b: string): string;",
    "export type Mode = 'fast' | 'slow';",
    "export interface Options {",
    "  /** How fast. */",
    "  mode?: Mode;",
    "  retries: number;",
    "}",
    "export type Alias = Options;",
    "",
  ].join("\n"),
  "node_modules/typed-lib/dist/client.d.ts": [
    "/**",
    " * The main client.",
    " * @example new Client({ retries: 1 })",
    " */",
    "export declare class Client {",
    "  constructor(options: import('./index').Options);",
    "  /** Sends a request. */",
    "  send(path: string, body?: unknown): Promise<string>;",
    "  private secret;",
    "  static create(): Client;",
    "}",
    "",
  ].join("\n"),
  "node_modules/typed-lib/dist/helpers.d.ts": "export declare function helper(x: string): void;\nexport declare function notReexported(): void;\n",
  "node_modules/typed-lib/dist/extra.d.ts": "export declare const VERSION: string;\n",
};

test("overview lists version, modules, deps and flattened re-exports", async (t) => {
  const dir = await makeFixture(TYPED_PKG);
  t.after(() => cleanupFixture(dir));

  const r = await tsLib(new Sandbox(dir), "typed-lib");
  assert.equal(r.view, "overview");
  assert.match(r.text, /^typed-lib 2\.1\.0 \(npm\)/);
  assert.match(r.text, /Location: node_modules\/typed-lib/);
  assert.match(r.text, /API read from: node_modules\/typed-lib\/dist\/index\.d\.ts/);
  assert.match(r.text, /Summary: A typed test library/);
  assert.match(r.text, /Dependencies: dep-a \^1\.0\.0/);
  assert.match(r.text, /Modules: typed-lib, typed-lib\/extra/);
  assert.match(r.text, /class Client/);
  assert.match(r.text, /function helper\(x: string\): void/); // renamedHelper
  assert.match(r.text, /function add\(a: number, b: number\): number/);
  assert.match(r.text, /interface Options\s+\(\+2 members\)/);
  assert.doesNotMatch(r.text, /notReexported/);
});

test("symbol view shows overloads, docs and members, hiding private members", async (t) => {
  const dir = await makeFixture(TYPED_PKG);
  t.after(() => cleanupFixture(dir));

  const add = await tsLib(new Sandbox(dir), "typed-lib", { symbol: "add" });
  assert.equal(add.view, "symbol");
  assert.match(add.text, /== add \(2 declarations\)/);
  assert.match(add.text, /Adds numbers\./);
  assert.match(add.text, /Adds strings\./);

  const client = await tsLib(new Sandbox(dir), "typed-lib", { symbol: "Client" });
  assert.match(client.text, /The main client\./);
  assert.match(client.text, /@example new Client/);
  assert.match(client.text, /Source: node_modules\/typed-lib\/dist\/client\.d\.ts:5/);
  assert.match(client.text, /send\(path: string, body\?: unknown\): Promise<string>/);
  assert.match(client.text, /\/\/ Sends a request\./);
  assert.match(client.text, /static create\(\): Client/);
  assert.match(client.text, /constructor\(options: import\('\.\/index'\)\.Options\)/);
  assert.doesNotMatch(client.text, /secret/);

  const member = await tsLib(new Sandbox(dir), "typed-lib", { symbol: "Client.send()" });
  assert.match(member.text, /== Client\.send/);
});

test("a type alias shows the members of the type it refers to", async (t) => {
  const dir = await makeFixture(TYPED_PKG);
  t.after(() => cleanupFixture(dir));

  const r = await tsLib(new Sandbox(dir), "typed-lib", { symbol: "Alias" });
  assert.match(r.text, /type Alias = Options/);
  assert.match(r.text, /mode\?: Mode/);
  assert.match(r.text, /\/\/ How fast\./);
});

test("module selects a subpath export", async (t) => {
  const dir = await makeFixture(TYPED_PKG);
  t.after(() => cleanupFixture(dir));

  for (const module of ["typed-lib/extra", "./extra", "extra"]) {
    const r = await tsLib(new Sandbox(dir), "typed-lib", { module });
    assert.match(r.text, /module typed-lib\/extra/);
    assert.match(r.text, /const VERSION: string/);
  }
  await assert.rejects(() => tsLib(new Sandbox(dir), "typed-lib", { module: "missing" }), /Available modules: typed-lib, typed-lib\/extra/);
});

test("query searches names, notFound suggests close names", async (t) => {
  const dir = await makeFixture(TYPED_PKG);
  t.after(() => cleanupFixture(dir));

  const q = await tsLib(new Sandbox(dir), "typed-lib", { query: "SEND" });
  assert.equal(q.view, "search");
  assert.match(q.text, /send\(path: string.*\[in Client\]/);

  const nf = await tsLib(new Sandbox(dir), "typed-lib", { symbol: "Clientt.sendd" });
  assert.equal(nf.view, "notFound");
  const nf2 = await tsLib(new Sandbox(dir), "typed-lib", { symbol: "mod" });
  assert.equal(nf2.view, "notFound");
  assert.match(nf2.text, /Options\.mode/);
});

test("falls back to @types and notes it", async (t) => {
  const dir = await makeFixture({
    "node_modules/untyped/package.json": pkgJson({ name: "untyped", version: "1.0.0", main: "index.js" }),
    "node_modules/untyped/index.js": "module.exports = function untyped(a) { return a; };\n",
    "node_modules/@types/untyped/package.json": pkgJson({ name: "@types/untyped", version: "1.0.3", types: "index.d.ts" }),
    "node_modules/@types/untyped/index.d.ts": "declare function untyped(a: string): string;\ndeclare namespace untyped { const flag: boolean; }\nexport = untyped;\n",
  });
  t.after(() => cleanupFixture(dir));

  const r = await tsLib(new Sandbox(dir), "untyped");
  assert.match(r.text, /^untyped 1\.0\.0/);
  assert.match(r.text, /Types come from @types\/untyped 1\.0\.3/);
  assert.match(r.text, /CommonJS module/);
  assert.match(r.text, /function untyped\(a: string\): string/);
  assert.match(r.text, /const flag: boolean/);
});

test("plain JavaScript packages still list exports, with a note", async (t) => {
  const dir = await makeFixture({
    "node_modules/plainjs/package.json": pkgJson({ name: "plainjs", version: "0.1.0", main: "index.js" }),
    "node_modules/plainjs/index.js": "/** Greets. */\nexport function greet(name) { return 'hi ' + name; }\nexport const answer = 42;\n",
  });
  t.after(() => cleanupFixture(dir));

  const r = await tsLib(new Sandbox(dir), "plainjs");
  assert.match(r.text, /ships no type declarations/);
  assert.match(r.text, /function greet\(name: any\): string/);
  assert.match(r.text, /const answer: 42/);
});

test("scoped packages and packages hoisted to a parent node_modules are found", async (t) => {
  const dir = await makeFixture({
    "node_modules/@scope/pkg/package.json": pkgJson({ name: "@scope/pkg", version: "3.0.0", types: "index.d.ts" }),
    "node_modules/@scope/pkg/index.d.ts": "export declare function scoped(): void;\n",
    "apps/web/package.json": pkgJson({ name: "web" }),
  });
  t.after(() => cleanupFixture(dir));

  const r = await tsLib(new Sandbox(path.join(dir, "apps/web")), "@scope/pkg");
  assert.match(r.text, /@scope\/pkg 3\.0\.0/);
  assert.match(r.text, /function scoped\(\)/);
});

test("rejects bad package names and missing packages", async (t) => {
  const dir = await makeFixture({ "package.json": "{}" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(() => tsLib(new Sandbox(dir), "../etc"), /not a valid npm package name/);
  await assert.rejects(() => tsLib(new Sandbox(dir), "nope"), /not installed.*npm_list/);
  assert.throws(() => moduleSpecifier("a", "../b"), /Invalid module/);
});

test("files outside the installed-package locations are invisible while sandboxed", async (t) => {
  const base = await makeFixture({
    "outside/secret.d.ts": "export declare const SECRET: string;\n",
    "proj/node_modules/leaky/package.json": pkgJson({ name: "leaky", version: "1.0.0", types: "index.d.ts" }),
    "proj/node_modules/leaky/index.d.ts": 'export * from "../../../outside/secret";\nexport * from "./.env";\nexport declare const OK: number;\n',
    "proj/node_modules/leaky/.env.d.ts": "export declare const TOKEN: string;\n",
  });
  t.after(() => cleanupFixture(base));
  const dir = path.join(base, "proj");

  const r = await tsLib(new Sandbox(dir), "leaky");
  assert.match(r.text, /const OK: number/);
  assert.doesNotMatch(r.text, /SECRET/);
  assert.doesNotMatch(r.text, /TOKEN/);

  const off = await tsLib(new Sandbox(dir, false), "leaky");
  assert.match(off.text, /SECRET/);
});

test("a symlinked (linked/workspace) package is followed", async (t) => {
  const dir = await makeFixture({
    "packages/linked/package.json": pkgJson({ name: "linked", version: "0.2.0", types: "index.d.ts" }),
    "packages/linked/index.d.ts": "export declare function linkedFn(): void;\n",
    "node_modules/.keep": "",
  });
  t.after(() => cleanupFixture(dir));
  try {
    await fs.symlink(path.join(dir, "packages/linked"), path.join(dir, "node_modules/linked"), "dir");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EPERM") return t.skip("symlinks not permitted");
    throw err;
  }
  const r = await tsLib(new Sandbox(dir), "linked");
  assert.match(r.text, /function linkedFn\(\)/);
});

test("rejects when the signal is already aborted", async (t) => {
  const dir = await makeFixture(TYPED_PKG);
  t.after(() => cleanupFixture(dir));
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(() => extractTsLibrary(new Sandbox(dir), "typed-lib", { signal: ac.signal }), { name: "AbortError" });
});
