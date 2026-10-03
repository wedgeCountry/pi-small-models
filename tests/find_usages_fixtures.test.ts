import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { classifyPythonLine, detectPythonKind, type PythonKnownKind } from "../src/tools/usageRules/python.ts";
import { classifyTypeScriptLine } from "../src/tools/usageRules/typescript.ts";
import { classifyCSharpLine } from "../src/tools/usageRules/csharp.ts";

/**
 * Integration tests that run the classifiers over whole, realistic source files (committed as
 * static fixtures under tests/fixtures/find_usages/) rather than hand-picked single lines, to catch
 * interactions between patterns that isolated unit tests could miss — e.g. a file that defines a
 * symbol as both a class and a function, or a decoy identifier that's only a substring of the one
 * being searched for.
 *
 * Each line of interest carries a trailing marker comment: `# fu:<symbol>=<kind>` in Python,
 * `// fu:<symbol>=<kind>` in TS/C#. `<kind>` is a UsageKind, or the literal `null` for a line that
 * should NOT be classified as a usage at all (decoys). The marker is stripped before the line is
 * handed to the real classifier, so the marker text itself (which contains the symbol name) can
 * never bleed into the result.
 */

interface MarkedLine {
  lineNumber: number;
  code: string;
  symbol: string;
  expectedKind: string; // a UsageKind, or "null"
}

function parseMarkedLines(content: string, commentToken: "#" | "//"): MarkedLine[] {
  const escapedToken = commentToken === "#" ? "#" : "//";
  const markerRe = new RegExp(`^(.*?)\\s*${escapedToken}\\s*fu:([A-Za-z_]\\w*)=([\\w-]+)\\s*$`);
  const lines = content.split("\n");
  const result: MarkedLine[] = [];
  lines.forEach((line, idx) => {
    const m = markerRe.exec(line);
    if (!m) return;
    // All three groups are mandatory in markerRe, so they're always present when m matches.
    result.push({ lineNumber: idx + 1, code: m[1]!, symbol: m[2]!, expectedKind: m[3]! });
  });
  return result;
}

/** Strips trailing marker comments so detectPythonKind sees only real code (defensive — the
 * def/class patterns it checks don't actually anchor to end-of-line, but stripping keeps the
 * pre-pass input honest about what it's scanning). */
function stripPythonMarkers(content: string): string[] {
  return content.split("\n").map((line) => line.replace(/\s*#\s*fu:[A-Za-z_]\w*=[\w-]+\s*$/, ""));
}

test("python sample.py: every marked line classifies as expected", async () => {
  const file = path.join(import.meta.dirname, "fixtures/find_usages/python/sample.py");
  const content = await fs.readFile(file, "utf8");
  const marked = parseMarkedLines(content, "#");
  assert.ok(marked.length > 0, "fixture should contain marked lines");

  const codeLines = stripPythonMarkers(content);
  const knownKind = detectPythonKind(codeLines, "Handler");
  assert.equal(knownKind, "class", "sample.py only ever defines Handler as a class");

  for (const { lineNumber, code, symbol, expectedKind } of marked) {
    const actual = classifyPythonLine(code, symbol, knownKind);
    assert.equal(
      actual,
      expectedKind === "null" ? null : expectedKind,
      `line ${lineNumber} (${JSON.stringify(code)}): expected ${expectedKind}, got ${actual}`
    );
  }
});

test("python ambiguous.py: resolves per-symbol knownKind and labels bare calls accordingly", async () => {
  const file = path.join(import.meta.dirname, "fixtures/find_usages/python/ambiguous.py");
  const content = await fs.readFile(file, "utf8");
  const marked = parseMarkedLines(content, "#");
  assert.ok(marked.length > 0, "fixture should contain marked lines");

  const codeLines = stripPythonMarkers(content);
  const symbols = [...new Set(marked.map((m) => m.symbol))];
  const knownKindBySymbol = new Map<string, PythonKnownKind>(
    symbols.map((s) => [s, detectPythonKind(codeLines, s)])
  );

  assert.equal(knownKindBySymbol.get("Shape"), "class");
  assert.equal(knownKindBySymbol.get("Render"), "function");
  assert.equal(knownKindBySymbol.get("Widget"), "unknown");

  for (const { lineNumber, code, symbol, expectedKind } of marked) {
    const actual = classifyPythonLine(code, symbol, knownKindBySymbol.get(symbol));
    assert.equal(
      actual,
      expectedKind === "null" ? null : expectedKind,
      `line ${lineNumber} (${JSON.stringify(code)}): expected ${expectedKind}, got ${actual}`
    );
  }
});

test("typescript sample.ts: every marked line classifies as expected", async () => {
  const file = path.join(import.meta.dirname, "fixtures/find_usages/typescript/sample.ts");
  const content = await fs.readFile(file, "utf8");
  const marked = parseMarkedLines(content, "//");
  assert.ok(marked.length > 0, "fixture should contain marked lines");

  for (const { lineNumber, code, symbol, expectedKind } of marked) {
    const actual = classifyTypeScriptLine(code, symbol);
    assert.equal(
      actual,
      expectedKind === "null" ? null : expectedKind,
      `line ${lineNumber} (${JSON.stringify(code)}): expected ${expectedKind}, got ${actual}`
    );
  }
});

test("csharp Sample.cs: every marked line classifies as expected", async () => {
  const file = path.join(import.meta.dirname, "fixtures/find_usages/csharp/Sample.cs");
  const content = await fs.readFile(file, "utf8");
  const marked = parseMarkedLines(content, "//");
  assert.ok(marked.length > 0, "fixture should contain marked lines");

  for (const { lineNumber, code, symbol, expectedKind } of marked) {
    const actual = classifyCSharpLine(code, symbol);
    assert.equal(
      actual,
      expectedKind === "null" ? null : expectedKind,
      `line ${lineNumber} (${JSON.stringify(code)}): expected ${expectedKind}, got ${actual}`
    );
  }
});
