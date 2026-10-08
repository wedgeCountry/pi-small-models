import { test } from "node:test";
import assert from "node:assert/strict";
import { TypeScriptPreviewManager } from "../src/tools/previewManagers/typescript.ts";
import type { PeekVisibility } from "../src/tools/previewManagers/types.ts";

const manager = new TypeScriptPreviewManager();
function peek(source: string, visibility: PeekVisibility = "public", includeDocs = false): string[] {
  return manager.preview(source.split("\n"), { visibility, includeDocs, maxDepth: 6 }).map((l) => `${l.line}:${l.text}`);
}

test("exported functions show their signature with the body replaced", () => {
  const src = `import { x } from "y";
export function add(a: number, b: number): number {
  return a + b;
}
export async function load(
  id: string,
): Promise<void> {
  await x(id);
}`;
  assert.deepEqual(peek(src), [
    "2:export function add(a: number, b: number): number { … }",
    "5:export async function load(",
    "6:  id: string,",
    "7:): Promise<void> { … }",
  ]);
});

test("non-exported top-level declarations are private", () => {
  const src = `function helper() { return 1 }
const local = () => 2;
export const shared = 3;`;
  assert.deepEqual(peek(src), ["3:export const shared = …"]);
  assert.deepEqual(peek(src, "private"), ["1:function helper() { … }", "2:const local = () => …", "3:export const shared = …"]);
});

test("arrow-function variables show their parameters; other initializers are cut", () => {
  const src = `export const make = async (a: number): Promise<number> => {
  return a;
};
export const config = {
  port: 80,
};
export const LIMIT = 10;`;
  assert.deepEqual(peek(src), [
    "1:export const make = async (a: number): Promise<number> => …",
    "4:export const config = …",
    "7:export const LIMIT = …",
  ]);
});

test("class members: public by default, protected and private/# by modifier", () => {
  const src = `export class Svc extends Base {
  static VERSION = "1";
  protected count = 0;
  private cache = new Map<string, { a: number }>();
  #secret = 1;

  constructor(private readonly dep: Dep) {
    super();
  }

  get value(): string { return "x"; }
  protected helper(): () => void { return () => {}; }
  private hidden() {}
  handler = (e: Event) => { console.log(e); };
}`;
  assert.deepEqual(peek(src), [
    "1:export class Svc extends Base {",
    "2:  static VERSION = …",
    "7:  constructor(private readonly dep: Dep) { … }",
    "11:  get value(): string { … }",
    "14:  handler = (e: Event) => …",
  ]);
  assert.deepEqual(
    peek(src, "protected").map((l) => l.split(":")[0]),
    ["1", "2", "3", "7", "11", "12", "14"]
  );
  assert.equal(peek(src, "private").length, 10);
});

test("a non-exported class and all of its members are hidden at public", () => {
  const src = `class Internal {
  run() {}
}
export class Api {
  run() {}
}`;
  assert.deepEqual(peek(src), ["4:export class Api {", "5:  run() { … }"]);
});

test("interfaces, enums and object type aliases are shown verbatim, union aliases in full", () => {
  const src = `export interface Options {
  size: number;
  nested: {
    deep: boolean;
  };
  fn(a: string): void;
}
export enum Color { Red, Green }
export type Kind =
  | "a"
  | "b";
export type Pair = { a: number; b: number };`;
  assert.deepEqual(peek(src), [
    "1:export interface Options {",
    "2:  size: number;",
    "3:  nested: {",
    "4:    deep: boolean;",
    "6:  fn(a: string): void;",
    "8:export enum Color { Red, Green }",
    "9:export type Kind =",
    `10:  | "a"`,
    `11:  | "b";`,
    "12:export type Pair = { a: number; b: number };",
  ]);
});

test("decorators, overloads, default exports and re-exports", () => {
  const src = `@Injectable()
export class S {
  @Input() name: string;
}
export function over(a: string): void;
export function over(a: any) {}
export default function main() {
  return 0
}
export { a, b } from "./c";`;
  assert.deepEqual(peek(src), [
    "1:@Injectable()",
    "2:export class S {",
    "3:  @Input() name: string;",
    "5:export function over(a: string): void;",
    "6:export function over(a: any) { … }",
    "7:export default function main() { … }",
    `10:export { a, b } from "./c";`,
  ]);
});

test("braces inside strings, templates, regexes and comments don't confuse the outline", () => {
  const src = `export function tricky() {
  const a = "}";
  const b = \`\${ { x: 1 }.x } }\`;
  const c = /[{]/g;
  // }
  /* } */
}
export function after() {}`;
  assert.deepEqual(peek(src), ["1:export function tricky() { … }", "8:export function after() { … }"]);
});

test("statements without semicolons end at the line break (ASI)", () => {
  const src = `export abstract class A {
  abstract run(): void
  stop(): void {}
}
export const x = 1
export function f() {}`;
  assert.deepEqual(peek(src), [
    "1:export abstract class A {",
    "2:  abstract run(): void",
    "3:  stop(): void { … }",
    "5:export const x = …",
    "6:export function f() { … }",
  ]);
});

test("namespaces show their exported members", () => {
  const src = `export namespace NS {
  export function f() {}
  function g() {}
}`;
  assert.deepEqual(peek(src), ["1:export namespace NS {", "2:  export function f() { … }"]);
});

test("includeDocs adds JSDoc blocks, including inside interfaces", () => {
  const src = `/**
 * Adds.
 */
export function add() {}
export interface I {
  /** the size */
  size: number;
}`;
  assert.deepEqual(peek(src), ["4:export function add() { … }", "5:export interface I {", "7:  size: number;"]);
  assert.deepEqual(peek(src, "public", true), [
    "1:/**",
    "2: * Adds.",
    "3: */",
    "4:export function add() { … }",
    "5:export interface I {",
    "6:  /** the size */",
    "7:  size: number;",
  ]);
});
