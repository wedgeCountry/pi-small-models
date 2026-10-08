import { test } from "node:test";
import assert from "node:assert/strict";
import { CSharpPreviewManager } from "../src/tools/previewManagers/csharp.ts";
import type { PeekVisibility } from "../src/tools/previewManagers/types.ts";

const manager = new CSharpPreviewManager();
function peek(source: string, visibility: PeekVisibility = "public", includeDocs = false): string[] {
  return manager.preview(source.split("\n"), { visibility, includeDocs, maxDepth: 6 }).map((l) => `${l.line}:${l.text}`);
}

test("Allman-style namespace, class and methods: signatures with bodies folded", () => {
  const src = `using System;

namespace Demo
{
    public class Widget : Base
    {
        public Widget(int x) : base(x)
        {
        }

        public void Add(int item)
        {
            Console.WriteLine(item);
        }
    }
}`;
  assert.deepEqual(peek(src), [
    "3:namespace Demo",
    "5:    public class Widget : Base",
    "7:        public Widget(int x) : base(x) { … }",
    "11:        public void Add(int item) { … }",
  ]);
});

test("access levels: public / protected (incl. protected internal) / private (internal, private protected, none)", () => {
  const src = `public class C {
    public void A() {}
    protected void B() {}
    protected internal void C2() {}
    internal void D() {}
    private protected void E() {}
    private void F() {}
    void G() {}
}`;
  assert.deepEqual(peek(src).map((l) => l.split(":")[0]), ["1", "2"]);
  assert.deepEqual(peek(src, "protected").map((l) => l.split(":")[0]), ["1", "2", "3", "4"]);
  assert.equal(peek(src, "private").length, 8);
});

test("non-public types and their members are hidden at public", () => {
  const src = `internal class Hidden { public void X() {} }
class AlsoHidden { public void Y() {} }
public class Shown {
    private class Secret { public void S() {} }
    public class Nested { public void N() {} }
}`;
  assert.deepEqual(peek(src), ["3:public class Shown {", "5:    public class Nested { public void N() { … } }"]);
});

test("properties, fields, expression bodies, operators, indexers and events", () => {
  const src = `public class P {
    public const int Max = 10;
    public int Count { get; private set; }
    public string Name { get; set; } = "x";
    public int Total
    {
        get { return 1; }
    }
    public int Twice(int x) => x * 2;
    public static P operator +(P a, P b) { return a; }
    public int this[int i] => i;
    public event EventHandler Changed;
}`;
  assert.deepEqual(peek(src), [
    "1:public class P {",
    "2:    public const int Max = …",
    "3:    public int Count { get; private set; }",
    "4:    public string Name { get; set; }",
    "5:    public int Total { … }",
    "9:    public int Twice(int x) => …",
    "10:    public static P operator +(P a, P b) { … }",
    "11:    public int this[int i] => …",
    "12:    public event EventHandler Changed;",
  ]);
});

test("interface members are public without a modifier; enums are verbatim", () => {
  const src = `public interface IWidget
{
    int Count { get; }
    void Reset();
}
public enum Mode
{
    A,
    B = 2,
}`;
  assert.deepEqual(peek(src), [
    "1:public interface IWidget",
    "3:    int Count { get; }",
    "4:    void Reset();",
    "6:public enum Mode",
    "8:    A,",
    "9:    B = 2,",
  ]);
});

test("records, delegates, file-scoped namespaces and multi-line signatures", () => {
  const src = `namespace Demo;
public record Point(int X, int Y);
public delegate void Callback(int x);
public class S {
    protected virtual async Task<int> LoadAsync(
        string id,
        CancellationToken ct = default)
    {
        return 1;
    }
}`;
  assert.deepEqual(peek(src, "protected"), [
    "1:namespace Demo;",
    "2:public record Point(int X, int Y);",
    "3:public delegate void Callback(int x);",
    "4:public class S {",
    "5:    protected virtual async Task<int> LoadAsync(",
    "6:        string id,",
    "7:        CancellationToken ct = default) { … }",
  ]);
});

test("braces in regular, verbatim, interpolated and raw strings and char literals are ignored", () => {
  const src = `public class T {
    public void M() {
        var a = "}";
        var b = @"C:\\x\\""}""";
        var c = $"{{ {(x > 0 ? "}" : "{")} }}";
        var d = """
            }
            """;
        var e = '}';
    }
    public void After() {}
}`;
  assert.deepEqual(peek(src), ["1:public class T {", "2:    public void M() { … }", "11:    public void After() { … }"]);
});

test("attributes are shown with their declaration; #region lines are skipped", () => {
  const src = `#region Api
[Serializable]
public class A {
    [Obsolete("no")]
    public void Old() {}
    [Fact] public void Inline() {}
    [Obsolete]
    private void Hidden() {}
}
#endregion`;
  assert.deepEqual(peek(src), [
    "2:[Serializable]",
    "3:public class A {",
    `4:    [Obsolete("no")]`,
    "5:    public void Old() { … }",
    "6:    [Fact] public void Inline() { … }",
  ]);
});

test("includeDocs adds /// XML doc comments", () => {
  const src = `/// <summary>
/// A widget.
/// </summary>
public class W {
    /// <summary>Adds.</summary>
    public void Add() {}
}`;
  assert.deepEqual(peek(src), ["4:public class W {", "6:    public void Add() { … }"]);
  assert.deepEqual(peek(src, "public", true), [
    "1:/// <summary>",
    "2:/// A widget.",
    "3:/// </summary>",
    "4:public class W {",
    "5:    /// <summary>Adds.</summary>",
    "6:    public void Add() { … }",
  ]);
});
