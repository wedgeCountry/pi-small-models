import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyTypeScriptLine } from "../src/tools/usageRules/typescript.ts";

test("classifies named and default imports", () => {
  assert.equal(classifyTypeScriptLine('import { Handler } from "./handler";', "Handler"), "import");
  assert.equal(classifyTypeScriptLine('import { Foo, Handler } from "./handler";', "Handler"), "import");
  assert.equal(classifyTypeScriptLine('import Handler from "./handler";', "Handler"), "import");
  assert.equal(classifyTypeScriptLine('import * as Handler from "./handler";', "Handler"), "import");
});

test("classifies a CommonJS require as import", () => {
  assert.equal(classifyTypeScriptLine('const { Handler } = require("./handler");', "Handler"), "import");
});

test("classifies a class definition", () => {
  assert.equal(classifyTypeScriptLine("class Handler {", "Handler"), "definition");
  // Still a definition of Handler even though the line also mentions a (different) base class —
  // the `class Handler` pattern is checked before any type-reference pattern.
  assert.equal(classifyTypeScriptLine("export class Handler extends Base {", "Handler"), "definition");
});

test("classifies a base class reference as type-reference (symbol is the base, not the class being defined)", () => {
  assert.equal(classifyTypeScriptLine("class MyHandler extends Handler {", "Handler"), "type-reference");
  assert.equal(classifyTypeScriptLine("class MyHandler implements Handler {", "Handler"), "type-reference");
});

test("classifies a function definition", () => {
  assert.equal(classifyTypeScriptLine("function Handler(req) {", "Handler"), "definition");
  assert.equal(classifyTypeScriptLine("export function Handler(req) {", "Handler"), "definition");
  assert.equal(classifyTypeScriptLine("async function Handler(req) {", "Handler"), "definition");
});

test("classifies an arrow function assignment as definition", () => {
  assert.equal(classifyTypeScriptLine("const Handler = (req) => {", "Handler"), "definition");
  assert.equal(classifyTypeScriptLine("const Handler = async (req) => {", "Handler"), "definition");
  assert.equal(classifyTypeScriptLine("const Handler = req => {", "Handler"), "definition");
});

test("classifies an interface/type definition", () => {
  assert.equal(classifyTypeScriptLine("interface Handler {", "Handler"), "definition");
  assert.equal(classifyTypeScriptLine("type Handler = () => void;", "Handler"), "definition");
});

test("classifies instantiation via new", () => {
  assert.equal(classifyTypeScriptLine("const h = new Handler();", "Handler"), "instantiation");
});

test("classifies type annotations and generics as type-reference", () => {
  assert.equal(classifyTypeScriptLine("function process(h: Handler) {", "Handler"), "type-reference");
  assert.equal(classifyTypeScriptLine("const list: Array<Handler> = [];", "Handler"), "type-reference");
  assert.equal(classifyTypeScriptLine("implements Handler {", "Handler"), "type-reference");
});

test("classifies qualified access as static-access, in both directions", () => {
  assert.equal(classifyTypeScriptLine("Handler.create();", "Handler"), "static-access");
  assert.equal(classifyTypeScriptLine("registry.Handler();", "Handler"), "static-access");
});

test("classifies a bare call as call (no ambiguity, unlike Python)", () => {
  assert.equal(classifyTypeScriptLine("Handler(req);", "Handler"), "call");
});

test("classifies a bare reference with no call as reference", () => {
  assert.equal(classifyTypeScriptLine("onClick={Handler}", "Handler"), "reference");
});

test("returns null when the symbol does not occur on the line", () => {
  assert.equal(classifyTypeScriptLine("const x = 1;", "Handler"), null);
});

test("matching is case-sensitive", () => {
  assert.equal(classifyTypeScriptLine("const handler = 1;", "Handler"), null);
  assert.equal(classifyTypeScriptLine("class handler {}", "Handler"), null);
  assert.equal(classifyTypeScriptLine("const HANDLER = 1;", "Handler"), null);
});

test("does not match a symbol that is only a substring of a longer identifier", () => {
  assert.equal(classifyTypeScriptLine("HandlerFactory();", "Handler"), null);
  assert.equal(classifyTypeScriptLine("const x = new MyHandler();", "Handler"), null);
});

test("priority order: new always wins over a plain call classification", () => {
  // `new Handler()` must never fall through to the generic "call" bucket.
  assert.equal(classifyTypeScriptLine("return new Handler();", "Handler"), "instantiation");
});
