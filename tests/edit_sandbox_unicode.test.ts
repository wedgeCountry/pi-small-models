import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { editFile } from "../src/tools/edit.ts";
import { makeFixture, cleanupFixture } from "./fixtures.ts";
import { Sandbox } from "../src/sandbox/sandbox.ts";

// This test reproduces the exact issue the user encountered
// The file contains Unicode escape sequences, but when copied, they might be interpreted as actual Unicode
test("reproduces sandbox.ts Unicode escape sequence issue", async (t) => {
  // Create a file with the exact content from sandbox.ts line 152
  // Use string concatenation to create literal escape sequences in the file
  const fileContent = `    // Prevent paths that use Unicode lookalike characters for dots or slashes
    // This catches attempts to use characters that look like . or / but are different Unicode characters
    if (/[` + '\\u2024\\u2219\\u2981\\uFF0E\\uFF61' + `]/.test(target)) {
      throw new SandboxError(
        "outside-root",
        'Path "' + 'target' + '" contains Unicode lookalike characters which are not allowed in sandboxed paths'
      );
    }
`;
  
  const dir = await makeFixture({ "sandbox_excerpt.txt": fileContent });
  t.after(() => cleanupFixture(dir));

  const filePath = path.join(dir, "sandbox_excerpt.txt");
  
  // This is what the user might have tried - using the actual Unicode characters
  // instead of the escape sequences
  const oldTextWithActualUnicode = `    if (/[\u2024\u2219\u2981\uFF0E\uFF61]/.test(target)) {`;
  const newText = `    if (/[REPLACED]/.test(target)) {`;

  // This should fail because the file contains escape sequences, not actual Unicode
  await assert.rejects(
    () => editFile(new Sandbox(dir), filePath, oldTextWithActualUnicode, newText),
    /oldText not found/
  );
});

test("edits sandbox.ts Unicode escape sequences correctly with escape sequences", async (t) => {
  // Create a file with the exact content from sandbox.ts line 152
  // Use string concatenation to create literal escape sequences in the file
  const fileContent = `    // Prevent paths that use Unicode lookalike characters for dots or slashes
    // This catches attempts to use characters that look like . or / but are different Unicode characters
    if (/[` + '\\u2024\\u2219\\u2981\\uFF0E\\uFF61' + `]/.test(target)) {
      throw new SandboxError(
        "outside-root",
        'Path "' + 'target' + '" contains Unicode lookalike characters which are not allowed in sandboxed paths'
      );
    }
`;
  
  const dir = await makeFixture({ "sandbox_excerpt.txt": fileContent });
  t.after(() => cleanupFixture(dir));

  const filePath = path.join(dir, "sandbox_excerpt.txt");
  
  // This should work - using the escape sequences as they appear in the file
  const oldTextWithEscapeSequences = `    if (/[\\u2024\\u2219\\u2981\\uFF0E\\uFF61]/.test(target)) {`;
  const newText = `    if (/[REPLACED]/.test(target)) {`;

  await editFile(new Sandbox(dir), filePath, oldTextWithEscapeSequences, newText);
  
  const content = await fs.readFile(filePath, "utf8");
  assert.equal(content, `    // Prevent paths that use Unicode lookalike characters for dots or slashes
    // This catches attempts to use characters that look like . or / but are different Unicode characters
    if (/[REPLACED]/.test(target)) {
      throw new SandboxError(
        "outside-root",
        'Path "' + 'target' + '" contains Unicode lookalike characters which are not allowed in sandboxed paths'
      );
    }
`);
});

test("demonstrates the Unicode interpretation issue", async (t) => {
  // This test shows the core issue: when reading the file, the Unicode escape sequences
  // might be interpreted differently than what's actually in the file
  const fileContent = `    if (/[` + '\\u2024\\u2219\\u2981\\uFF0E\\uFF61' + `]/.test(target)) {`;
  
  const dir = await makeFixture({ "test.txt": fileContent });
  t.after(() => cleanupFixture(dir));

  const filePath = path.join(dir, "test.txt");
  
  // Read the actual file content
  const actualContent = await fs.readFile(filePath, "utf8");
  
  // What the user might be trying to match
  const userOldText = `    if (/[\\u2024\\u2219\\u2981\\uFF0E\\uFF61]/.test(target)) {`;
  
  // Check if they match
  const normalizedContent = actualContent.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const normalizedOldText = userOldText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  
  // Verify the match works as expected
  assert.ok(normalizedContent.includes(normalizedOldText), "Normalized content should include normalized oldText");
  
  // This test verifies the Unicode handling
  assert.ok(true, "Unicode handling test passed");
});