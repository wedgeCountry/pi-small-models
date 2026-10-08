/**
 * Pentest — Finding H5 (High, functional): grep is unusable for its intended small-model user.
 *
 * (a) The grep tool schema never declares `pattern`, so the model is never told the parameter
 *     exists, and a call without it builds `new RegExp(undefined)` which matches every line.
 * (b) `scanInWorker` arms a 1 s "startup" timer that is only cleared when the whole scan finishes,
 *     so any scan longer than 1 s fails with "Worker failed to initialize within 1 second" — the
 *     intended 5 s budget never applies.
 *
 * Secure expectations below FAIL today.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { Sandbox } from "../../src/sandbox/sandbox.ts";
import { grepFiles } from "../../src/tools/grep.ts";
import { GREP_TOOL_DEFINITION } from "../../src/tool_definitions/grep.ts";
import { makeFixture, cleanupFixture } from "../fixtures.ts";

test("H5a: the grep tool schema must declare a `pattern` parameter", () => {
  const props = Object.keys((GREP_TOOL_DEFINITION.parameters as { properties: Record<string, unknown> }).properties);
  assert.ok(
    props.includes("pattern"),
    `SECURITY/UX: grep's schema has no "pattern" field (properties: ${props.join(", ")}), so the model cannot search and an empty call matches every line`
  );
});

test("H5b: a grep scan that takes longer than 1 s must not fail as a startup timeout", async () => {
  const root = await makeFixture({});
  try {
    // Enough content that the worker's scan runs well past the 1 s startup timer but under the
    // intended 5 s budget.
    const line = "lorem ipsum dolor sit amet consectetur ".repeat(40) + "\n";
    const block = line.repeat(800);
    for (let i = 0; i < 500; i++) fs.writeFileSync(path.join(root, `f${i}.txt`), block);

    const sb = new Sandbox(root); // sandbox ON
    let error: Error | undefined;
    try {
      await grepFiles(sb, ".", "zzz-no-such-token-zzz", { timeoutMs: 5000 });
    } catch (err) {
      error = err as Error;
    }

    assert.ok(
      !(error && /initialize/i.test(error.message)),
      `SECURITY/UX: a legitimate scan failed with a 1 s startup timeout: ${error?.message}`
    );
  } finally {
    await cleanupFixture(root);
  }
});
