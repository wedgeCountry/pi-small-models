import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyCSharpLine } from "../src/tools/usageRules/csharp.ts";

test("classifies a using directive as import", () => {
  assert.equal(classifyCSharpLine("using App.Models.Handler;", "Handler"), "import");
  assert.equal(classifyCSharpLine("using static App.Models.Handler;", "Handler"), "import");
});

test("classifies a class/struct/interface/enum definition", () => {
  assert.equal(classifyCSharpLine("public class Handler {", "Handler"), "definition");
  assert.equal(classifyCSharpLine("internal struct Handler {", "Handler"), "definition");
  assert.equal(classifyCSharpLine("public interface Handler {", "Handler"), "definition");
  assert.equal(classifyCSharpLine("public enum Handler {", "Handler"), "definition");
});

test("classifies a method definition via its modifier chain", () => {
  assert.equal(classifyCSharpLine("public void Handler(Request req) {", "Handler"), "definition");
  assert.equal(classifyCSharpLine("private static int Handler() {", "Handler"), "definition");
  assert.equal(classifyCSharpLine("protected override Task Handler() {", "Handler"), "definition");
});

test("classifies a constructor definition (no return type, name matches class)", () => {
  assert.equal(classifyCSharpLine("public Handler(Request req) {", "Handler"), "definition");
  assert.equal(classifyCSharpLine("    private Handler() {", "Handler"), "definition");
});

test("classifies instantiation via new", () => {
  assert.equal(classifyCSharpLine("var h = new Handler();", "Handler"), "instantiation");
  assert.equal(classifyCSharpLine("return new Handler(req);", "Handler"), "instantiation");
});

test("classifies a base class/interface reference as type-reference", () => {
  assert.equal(classifyCSharpLine("public class MyHandler : Handler {", "Handler"), "type-reference");
});

test("classifies a generic type argument as type-reference", () => {
  assert.equal(classifyCSharpLine("List<Handler> handlers = new();", "Handler"), "type-reference");
});

test("classifies a parameter type as type-reference", () => {
  assert.equal(classifyCSharpLine("void Process(Handler h) {", "Handler"), "type-reference");
  assert.equal(classifyCSharpLine("void Process(int x, Handler h) {", "Handler"), "type-reference");
});

test("classifies a variable/field declaration as type-reference", () => {
  assert.equal(classifyCSharpLine("Handler handler = GetHandler();", "Handler"), "type-reference");
  assert.equal(classifyCSharpLine("private readonly Handler handler;", "Handler"), "type-reference");
});

test("classifies Handler as a method's return type as type-reference (not a definition of Handler itself)", () => {
  assert.equal(classifyCSharpLine("public Handler GetHandler() {", "Handler"), "type-reference");
});

test("classifies qualified access as static-access, in both directions", () => {
  assert.equal(classifyCSharpLine("Handler.Default();", "Handler"), "static-access");
  assert.equal(classifyCSharpLine("registry.Handler();", "Handler"), "static-access");
});

test("classifies a bare call as call", () => {
  assert.equal(classifyCSharpLine("Handler(req);", "Handler"), "call");
});

test("classifies a bare reference with no call as reference", () => {
  assert.equal(classifyCSharpLine("var fn = Handler;", "Handler"), "reference");
});

test("returns null when the symbol does not occur on the line", () => {
  assert.equal(classifyCSharpLine("var x = 1;", "Handler"), null);
});

test("matching is case-sensitive", () => {
  assert.equal(classifyCSharpLine("var handler = 1;", "Handler"), null);
  assert.equal(classifyCSharpLine("public class handler {}", "Handler"), null);
  assert.equal(classifyCSharpLine("var HANDLER = 1;", "Handler"), null);
});

test("does not match a symbol that is only a substring of a longer identifier", () => {
  assert.equal(classifyCSharpLine("HandlerFactory();", "Handler"), null);
  assert.equal(classifyCSharpLine("var x = new MyHandler();", "Handler"), null);
});

test("priority order: new always wins over a plain call classification", () => {
  assert.equal(classifyCSharpLine("    return new Handler(1);", "Handler"), "instantiation");
});
