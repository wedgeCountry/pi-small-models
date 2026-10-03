import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyPythonLine, detectPythonKind } from "../src/tools/usageRules/python.ts";

test("classifies a from-import line", () => {
  assert.equal(classifyPythonLine("from app.models import Handler", "Handler"), "import");
  assert.equal(classifyPythonLine("from app.models import (Handler, Other)", "Handler"), "import");
  assert.equal(classifyPythonLine("from app.models import Handler as H", "Handler"), "import");
});

test("classifies a bare import line", () => {
  assert.equal(classifyPythonLine("import Handler", "Handler"), "import");
});

test("classifies a function definition", () => {
  assert.equal(classifyPythonLine("def Handler(request):", "Handler"), "definition");
  assert.equal(classifyPythonLine("async def Handler(request):", "Handler"), "definition");
  assert.equal(classifyPythonLine("    def Handler(self):", "Handler"), "definition");
});

test("classifies a class definition", () => {
  assert.equal(classifyPythonLine("class Handler:", "Handler"), "definition");
  assert.equal(classifyPythonLine("class Handler(Base):", "Handler"), "definition");
});

test("classifies a type annotation as type-reference", () => {
  assert.equal(classifyPythonLine("def process(h: Handler) -> None:", "Handler"), "type-reference");
  assert.equal(classifyPythonLine("def make() -> Handler:", "Handler"), "type-reference");
  assert.equal(classifyPythonLine("items: List[Handler] = []", "Handler"), "type-reference");
});

test("classifies a base class reference as type-reference", () => {
  assert.equal(classifyPythonLine("class MyHandler(Handler):", "Handler"), "type-reference");
});

test("classifies qualified access as static-access, in both directions", () => {
  assert.equal(classifyPythonLine("Handler.default()", "Handler"), "static-access");
  assert.equal(classifyPythonLine("registry.Handler()", "Handler"), "static-access");
});

test("classifies a bare reference with no call as reference", () => {
  assert.equal(classifyPythonLine("callback = Handler", "Handler"), "reference");
  assert.equal(classifyPythonLine("@Handler", "Handler"), "reference");
});

test("returns null when the symbol does not occur on the line", () => {
  assert.equal(classifyPythonLine("x = 1", "Handler"), null);
});

test("matching is case-sensitive", () => {
  assert.equal(classifyPythonLine("handler = 1", "Handler"), null);
  assert.equal(classifyPythonLine("class handler: pass", "Handler"), null);
  assert.equal(classifyPythonLine("HANDLER = 1", "Handler"), null);
});

test("does not match a symbol that is only a substring of a longer identifier", () => {
  assert.equal(classifyPythonLine("HandlerFactory()", "Handler"), null);
  assert.equal(classifyPythonLine("x = MyHandler()", "Handler"), null);
});

// --- The Python-specific ambiguity: bare `Symbol(` without `new` ---

test("detectPythonKind resolves class when only a class def is found", () => {
  const lines = ["class Handler:", "    pass", "h = Handler()"];
  assert.equal(detectPythonKind(lines, "Handler"), "class");
});

test("detectPythonKind resolves function when only a def is found", () => {
  const lines = ["def Handler(x):", "    return x", "Handler(1)"];
  assert.equal(detectPythonKind(lines, "Handler"), "function");
});

test("detectPythonKind reports unknown when neither or both are found", () => {
  assert.equal(detectPythonKind(["Handler(1)"], "Handler"), "unknown");
  assert.equal(
    detectPythonKind(["def Handler(x): pass", "class Handler: pass"], "Handler"),
    "unknown"
  );
});

test("a bare call is labeled instantiation when the symbol is a known class", () => {
  assert.equal(classifyPythonLine("h = Handler()", "Handler", "class"), "instantiation");
});

test("a bare call is labeled call when the symbol is a known function", () => {
  assert.equal(classifyPythonLine("Handler(1)", "Handler", "function"), "call");
});

test("a bare call is labeled invocation (honestly ambiguous) when the kind is unknown", () => {
  assert.equal(classifyPythonLine("Handler(1)", "Handler", "unknown"), "invocation");
  assert.equal(classifyPythonLine("Handler(1)", "Handler"), "invocation"); // default param
});

test("priority order: a typed-and-called line reports the type-reference, not the call", () => {
  // `foo: Handler = Handler()` satisfies both the annotation pattern and the bare-call pattern;
  // type-reference is checked first, so that's what's reported for this line.
  assert.equal(classifyPythonLine("foo: Handler = Handler()", "Handler", "class"), "type-reference");
});
