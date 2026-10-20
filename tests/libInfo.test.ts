import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSymbol, selectView } from "../src/tools/libInfo/query.ts";
import { renderLibrary, capOutput, MAX_OUTPUT_LINES } from "../src/tools/libInfo/format.ts";
import type { ApiEntry, LibExtraction } from "../src/tools/libInfo/types.ts";

function entry(kind: string, name: string, container = "", signature = `${kind} ${name}`, docs?: string): ApiEntry {
  return { kind, name, container, signature, docs };
}

const EX: LibExtraction = {
  info: { ecosystem: "python", name: "demo", version: "1.0" },
  rootContainer: "",
  entries: [
    entry("class", "Session", "", "class Session", "A session.\n\nLonger text."),
    entry("method", "get", "Session", "def get(self, url)", "GET a url."),
    entry("method", "post", "Session", "def post(self, url, data=None)"),
    entry("function", "get", "", "def get(url)"),
    entry("class", "Adapter", "", "class Adapter"),
    entry("method", "get", "Adapter", "def get(self)"),
    entry("method", "get", "Other", "def get(self)"),
    entry("method", "get", "Fourth", "def get(self)"),
  ],
};

test("normalizeSymbol strips call parens, generics and separators", () => {
  assert.equal(normalizeSymbol(" Foo<T>.bar() "), "Foo.bar");
  assert.equal(normalizeSymbol("Foo::bar"), "Foo.bar");
  assert.equal(normalizeSymbol("Foo#bar"), "Foo.bar");
  assert.equal(normalizeSymbol("Foo.prototype.bar"), "Foo.bar");
  assert.equal(normalizeSymbol("Map<string, List<int>>"), "Map");
});

test("exact match wins over suffix matches", () => {
  const v = selectView(EX, { symbol: "get" });
  assert.equal(v.view, "symbol");
  if (v.view !== "symbol") return;
  assert.deepEqual(v.groups.map((g) => g.name), ["get"]);
});

test("suffix and case-insensitive matches; members are listed", () => {
  const v = selectView(EX, { symbol: "session" });
  assert.equal(v.view, "symbol");
  if (v.view !== "symbol") return;
  assert.equal(v.groups[0]!.name, "Session");
  assert.equal(v.groups[0]!.memberTotal, 2);
});

test("too many distinct matches gives an ambiguous list", () => {
  const ex = { ...EX, entries: EX.entries.filter((e) => !(e.name === "get" && e.container === "")) };
  const v = selectView(ex, { symbol: "get" });
  assert.equal(v.view, "ambiguous");
});

test("overview shows root children with member counts; search ranks name matches first", () => {
  const r = renderLibrary(EX);
  assert.match(r.text, /class Session {2}\(\+2 members\)/);
  assert.doesNotMatch(r.text, /def post/);
  assert.doesNotMatch(r.text, /A session/); // no docs without includeDocs

  const withDocs = renderLibrary(EX, { includeDocs: true });
  assert.match(withDocs.text, /Longer text/);

  const v = selectView(EX, { query: "ge" });
  assert.equal(v.view, "search");
  if (v.view !== "search") return;
  assert.equal(v.entries[0]!.container, ""); // shortest qualified name first among equal scores
});

test("symbol view always shows docs; maxResults limits lists", () => {
  const r = renderLibrary(EX, { symbol: "Session" });
  assert.match(r.text, /Longer text/);
  assert.match(r.text, /\/\/ GET a url\./);
  const limited = renderLibrary(EX, { maxResults: 1 });
  assert.match(limited.text, /Showing 1 of 3/);
});

test("capOutput truncates by line count with a hint", () => {
  const lines = Array.from({ length: MAX_OUTPUT_LINES + 50 }, (_, i) => `line ${i}`);
  const { text, truncated } = capOutput(lines);
  assert.equal(truncated, true);
  assert.match(text, /Output truncated/);
});
