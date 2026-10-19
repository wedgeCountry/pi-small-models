import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { editFile } from "../src/tools/edit.ts";
import { makeFixture, cleanupFixture } from "./fixtures.ts";
import { Sandbox } from "../src/sandbox/sandbox.ts";

test("handles Unicode escape sequences vs actual Unicode characters", async (t) => {
  // This reproduces the exact scenario from sandbox.ts line 152
  // File contains literal escape sequences (backslash-u format)
  const dir = await makeFixture({ 
    "a.txt": "    if /[" + '\\u2024\\u2219\\u2981\\uFF0E\\uFF61' + "]/.test(target)) {\n"
  });
  t.after(() => cleanupFixture(dir));

  // Try to edit using the actual Unicode characters instead of escape sequences
  // This should fail because the file contains escape sequences, not actual Unicode
  await assert.rejects(() => 
    editFile(new Sandbox(dir), path.join(dir, "a.txt"), 
      "    if /[\u2024\u2219\u2981\uFF0E\uFF61]/.test(target)) {",
      "    if /[REPLACED]/.test(target)) {"
    )
  );
});

test("handles editing Unicode escape sequences correctly", async (t) => {
  // This reproduces the exact scenario from sandbox.ts line 152
  // File contains literal escape sequences (backslash-u format)
  const dir = await makeFixture({ 
    "a.txt": "    if /[" + '\\u2024\\u2219\\u2981\\uFF0E\\uFF61' + "]/.test(target)) {\n"
  });
  t.after(() => cleanupFixture(dir));

  // Try to edit using the escape sequences (as they appear in the file)
  await editFile(new Sandbox(dir), path.join(dir, "a.txt"), 
    "    if /[" + '\\u2024\\u2219\\u2981\\uFF0E\\uFF61' + "]/.test(target)) {",
    "    if /[REPLACED]/.test(target)) {"
  );
  const content = await fs.readFile(path.join(dir, "a.txt"), "utf8");
  assert.equal(content, "    if /[REPLACED]/.test(target)) {\n");
});

test("handles editing actual Unicode characters correctly", async (t) => {
  // Create a file with actual Unicode characters (not escape sequences)
  const dir = await makeFixture({ 
    "a.txt": "    if /[\u2024\u2219\u2981\uFF0E\uFF61]/.test(target)) {\n"
  });
  t.after(() => cleanupFixture(dir));

  // Try to edit using the actual Unicode characters
  await editFile(new Sandbox(dir), path.join(dir, "a.txt"), 
    "    if /[\u2024\u2219\u2981\uFF0E\uFF61]/.test(target)) {",
    "    if /[REPLACED]/.test(target)) {"
  );
  const content = await fs.readFile(path.join(dir, "a.txt"), "utf8");
  assert.equal(content, "    if /[REPLACED]/.test(target)) {\n");
});

test("fails when mixing Unicode escape sequences and actual Unicode", async (t) => {
  // Create a file with actual Unicode characters
  const dir = await makeFixture({ 
    "a.txt": "    if /[\u2024\u2219\u2981\uFF0E\uFF61]/.test(target)) {\n"
  });
  t.after(() => cleanupFixture(dir));

  // Try to edit using escape sequences against actual Unicode characters
  await assert.rejects(() => 
    editFile(new Sandbox(dir), path.join(dir, "a.txt"), 
      "    if /[" + '\\u2024\\u2219\\u2981\\uFF0E\\uFF61' + "]/.test(target)) {",
      "    if /[REPLACED]/.test(target)) {"
    )
  );
});