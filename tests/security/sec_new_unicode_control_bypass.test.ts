/**
 * Pentest — Finding NEW-UNICODE-CTRL (HIGH): Unicode control character bypass
 * 
 * The sandbox does not adequately restrict directory names containing Unicode
 * control characters, allowing creation of directories that appear similar to
 * restricted ones but contain invisible or control characters.
 * 
 * Secure expectation: Paths containing control characters should be blocked.
 * These tests verify that the fixes are working correctly.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { Sandbox, SandboxError } from "../../src/sandbox/sandbox.ts";
import { writeFile } from "../../src/tools/write.ts";
import { makeFixture, cleanupFixture } from "../fixtures.ts";

// ============================================================================
// UNICODE CONTROL CHARACTER BYPASS
// ============================================================================

test("NEW-UNICODE-CTRL-1: Paths with control character U+0001 (Start of Heading) should be blocked", async (t) => {
  const root = await makeFixture({ "src/index.ts": "export const x = 1;" });
  t.after(() => cleanupFixture(root));

  const sb = new Sandbox(root);

  // This should throw SandboxError
  assert.throws(
    () => sb.resolve(".git\u0001/hello_world"),
    (err: unknown) => {
      return err instanceof SandboxError && (err.reason === "restricted" || err.reason === "outside-root");
    },
    "SECURITY: Paths with control character U+0001 should be blocked"
  );
});

test("NEW-UNICODE-CTRL-2: Paths with control character U+0002 (Start of Text) should be blocked", async (t) => {
  const root = await makeFixture({ "src/index.ts": "export const x = 1;" });
  t.after(() => cleanupFixture(root));

  const sb = new Sandbox(root);

  // This should throw SandboxError
  assert.throws(
    () => sb.resolve(".git\u0002/hello_world"),
    (err: unknown) => {
      return err instanceof SandboxError && (err.reason === "restricted" || err.reason === "outside-root");
    },
    "SECURITY: Paths with control character U+0002 should be blocked"
  );
});

test("NEW-UNICODE-CTRL-3: Paths with tab character (U+0009) should be blocked", async (t) => {
  const root = await makeFixture({ "src/index.ts": "export const x = 1;" });
  t.after(() => cleanupFixture(root));

  const sb = new Sandbox(root);

  // This should throw SandboxError
  assert.throws(
    () => sb.resolve(".git\t/hello_world"),
    (err: unknown) => {
      return err instanceof SandboxError && (err.reason === "restricted" || err.reason === "outside-root");
    },
    "SECURITY: Paths with tab character should be blocked"
  );
});

test("NEW-UNICODE-CTRL-4: Paths with newline character (U+000A) should be blocked", async (t) => {
  const root = await makeFixture({ "src/index.ts": "export const x = 1;" });
  t.after(() => cleanupFixture(root));

  const sb = new Sandbox(root);

  // This should throw SandboxError
  assert.throws(
    () => sb.resolve(".git\n/hello_world"),
    (err: unknown) => {
      return err instanceof SandboxError && (err.reason === "restricted" || err.reason === "outside-root");
    },
    "SECURITY: Paths with newline character should be blocked"
  );
});

test("NEW-UNICODE-CTRL-5: Paths with carriage return (U+000D) should be blocked", async (t) => {
  const root = await makeFixture({ "src/index.ts": "export const x = 1;" });
  t.after(() => cleanupFixture(root));

  const sb = new Sandbox(root);

  // This should throw SandboxError
  assert.throws(
    () => sb.resolve(".git\r/hello_world"),
    (err: unknown) => {
      return err instanceof SandboxError && (err.reason === "restricted" || err.reason === "outside-root");
    },
    "SECURITY: Paths with carriage return should be blocked"
  );
});

test("NEW-UNICODE-CTRL-6: Paths with space character (U+0020) should be blocked for restricted dirs", async (t) => {
  const root = await makeFixture({ "src/index.ts": "export const x = 1;" });
  t.after(() => cleanupFixture(root));

  const sb = new Sandbox(root);

  // This should throw SandboxError
  assert.throws(
    () => sb.resolve(".git /hello_world"),
    (err: unknown) => {
      return err instanceof SandboxError && err.reason === "restricted";
    },
    "SECURITY: Paths with space before restricted dir should be blocked"
  );
});

test("NEW-UNICODE-CTRL-7: Sandbox should block resolve of paths with control characters", async (t) => {
  const root = await makeFixture({ "src/index.ts": "export const x = 1;" });
  t.after(() => cleanupFixture(root));

  const sb = new Sandbox(root);

  // Test multiple control characters
  const controlChars = ["\u0001", "\u0002", "\t", "\n", "\r"];
  
  for (const char of controlChars) {
    assert.throws(
      () => sb.resolve(`.git${char}/hello_world`),
      (err: unknown) => {
        return err instanceof SandboxError && (err.reason === "restricted" || err.reason === "outside-root");
      },
      `SECURITY: Path with control character should be blocked`
    );
  }
});

test("NEW-UNICODE-CTRL-8: All control characters (0x00-0x1F, 0x7F) should be blocked", () => {
  const sb = new Sandbox("/tmp/test");
  
  // Test that control characters are not allowed in paths
  for (let i = 0x00; i <= 0x1F; i++) {
    const char = String.fromCharCode(i);
    const testPath = `.git${char}/test`;
    
    assert.throws(
      () => sb.resolve(testPath),
      (err: unknown) => {
        return err instanceof SandboxError && (err.reason === "restricted" || err.reason === "outside-root");
      },
      `SECURITY: Control character U+${i.toString(16).padStart(4, '0')} should be blocked`
    );
  }
  
  // Test DEL character (0x7F)
  const delChar = String.fromCharCode(0x7F);
  const delTestPath = `.git${delChar}/test`;
  assert.throws(
    () => sb.resolve(delTestPath),
    (err: unknown) => {
      return err instanceof SandboxError && (err.reason === "restricted" || err.reason === "outside-root");
    },
    "SECURITY: DEL character (U+007F) should be blocked"
  );
});

test("NEW-UNICODE-CTRL-9: Unicode whitespace characters should be blocked", () => {
  const sb = new Sandbox("/tmp/test");
  
  // Test various Unicode whitespace characters
  const unicodeWhitespace = ["\u00A0", "\u1680", "\u2000", "\u2001", "\u2002", "\u2003", "\u2004", "\u2005", "\u2006", "\u2007", "\u2008", "\u2009", "\u200A", "\u2028", "\u2029", "\u202F", "\u205F", "\u3000"];
  
  for (const char of unicodeWhitespace) {
    const testPath = `.git${char}/test`;
    assert.throws(
      () => sb.resolve(testPath),
      (err: unknown) => {
        return err instanceof SandboxError && err.reason === "outside-root";
      },
      `SECURITY: Unicode whitespace character should be blocked`
    );
  }
});

test("NEW-UNICODE-CTRL-10: Write operations with control characters should be blocked", async (t) => {
  const root = await makeFixture({ "src/index.ts": "export const x = 1;" });
  t.after(() => cleanupFixture(root));

  const sb = new Sandbox(root);

  // This should throw SandboxError
  await assert.rejects(
    async () => await writeFile(sb, ".git\u0001/hello_world", "hello world"),
    (err: unknown) => {
      return err instanceof SandboxError && (err.reason === "restricted" || err.reason === "outside-root");
    },
    "SECURITY: Write operations with control characters should be blocked"
  );
});