import { test } from "node:test";
import assert from "node:assert/strict";
import { PythonPreviewManager } from "../src/tools/previewManagers/python.ts";
import type { PeekVisibility } from "../src/tools/previewManagers/types.ts";

const manager = new PythonPreviewManager();
function peek(source: string, visibility: PeekVisibility = "public", includeDocs = false): string[] {
  return manager.preview(source.split("\n"), { visibility, includeDocs, maxDepth: 6 }).map((l) => `${l.line}:${l.text}`);
}

test("shows class and def signatures without bodies", () => {
  const src = `class A(Base):
    x = 1

    def run(self, n: int) -> None:
        print(n)

def helper(a, b=2):
    return a + b`;
  assert.deepEqual(peek(src), ["1:class A(Base):", "4:    def run(self, n: int) -> None:", "7:def helper(a, b=2):"]);
});

test("keeps all lines of a multi-line signature and cuts one-line bodies at the colon", () => {
  const src = `async def fetch(
    url: str,
    timeout: float = 1.0,
) -> bytes:
    return b""

def short(x): return x * 2
class Empty: pass`;
  assert.deepEqual(peek(src), [
    "1:async def fetch(",
    "2:    url: str,",
    "3:    timeout: float = 1.0,",
    "4:) -> bytes:",
    "7:def short(x):",
    "8:class Empty:",
  ]);
});

test("does not cut at colons inside annotations, defaults, lambdas or strings", () => {
  const src = `def f(a: dict[str, int] = {"k:": 1}, g=lambda x: x) -> "x:y":
    pass`;
  assert.deepEqual(peek(src), [`1:def f(a: dict[str, int] = {"k:": 1}, g=lambda x: x) -> "x:y":`]);
});

test("visibility: plain and dunder names public, _name protected, __name private", () => {
  const src = `class C:
    def __init__(self): pass
    def pub(self): pass
    def _prot(self): pass
    def __priv(self): pass`;
  assert.deepEqual(peek(src, "public"), ["1:class C:", "2:    def __init__(self):", "3:    def pub(self):"]);
  assert.deepEqual(peek(src, "protected"), ["1:class C:", "2:    def __init__(self):", "3:    def pub(self):", "4:    def _prot(self):"]);
  assert.equal(peek(src, "private").length, 5);
});

test("members of a hidden class are hidden too", () => {
  const src = `class _Internal:
    def visible_name(self): pass
class Public:
    pass`;
  assert.deepEqual(peek(src), ["3:class Public:"]);
  assert.deepEqual(peek(src, "protected"), ["1:class _Internal:", "2:    def visible_name(self):", "3:class Public:"]);
});

test("functions nested in functions are never shown", () => {
  const src = `def outer():
    def inner():
        pass
    class Local:
        pass
    return inner`;
  assert.deepEqual(peek(src, "private"), ["1:def outer():"]);
});

test("nested classes inside classes are shown", () => {
  const src = `class Outer:
    class Inner:
        def m(self): pass`;
  assert.deepEqual(peek(src), ["1:class Outer:", "2:    class Inner:", "3:        def m(self):"]);
});

test("decorators are shown with their declaration and dropped with hidden ones", () => {
  const src = `@dataclass(
    frozen=True,
)
class P:
    @property
    def x(self): return 1
    @staticmethod
    def _hidden(): pass`;
  assert.deepEqual(peek(src), ["1:@dataclass(", "2:    frozen=True,", "3:)", "4:class P:", "5:    @property", "6:    def x(self):"]);
});

test("ignores def/class text inside triple-quoted strings, even at column 0", () => {
  const src = `TEMPLATE = """
def fake():
    pass
"""
def real():
    s = '''
class AlsoFake:
'''
    return s
def after(): pass`;
  assert.deepEqual(peek(src), ["5:def real():", "10:def after():"]);
});

test("module-level statements are not shown", () => {
  const src = `import os
CONSTANT = 1
if __name__ == "__main__":
    main()`;
  assert.deepEqual(peek(src, "private"), []);
});

test("includeDocs adds full module, class and function docstrings", () => {
  const src = `"""Module doc.

Details.
"""
class A:
    '''Class doc.'''
    def m(self):
        """Method doc
        spanning lines."""
        return 1
    def _p(self):
        """hidden doc"""`;
  assert.deepEqual(peek(src), ["5:class A:", "7:    def m(self):"]);
  assert.deepEqual(peek(src, "public", true), [
    `1:"""Module doc.`,
    "2:",
    "3:Details.",
    `4:"""`,
    "5:class A:",
    "6:    '''Class doc.'''",
    "7:    def m(self):",
    `8:        """Method doc`,
    `9:        spanning lines."""`,
  ]);
});

test("a string that is not the first statement is not a docstring", () => {
  const src = `def f():
    x = 1
    """not a docstring"""`;
  assert.deepEqual(peek(src, "public", true), ["1:def f():"]);
});
