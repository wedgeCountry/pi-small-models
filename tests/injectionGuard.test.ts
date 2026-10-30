import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const DEFINITIONS_DIR = new URL("../src/tool_definitions/", import.meta.url);

/** Every tool definition file, excluding the shared guideline module itself. */
async function definitionFiles(): Promise<string[]> {
  const names = await fs.readdir(DEFINITIONS_DIR);
  return names.filter((name) => name.endsWith(".ts") && name !== "README.md" && name !== "injectionGuard.ts");
}

test("every tool definition file sets promptGuidelines", async () => {
  for (const name of await definitionFiles()) {
    const source = await fs.readFile(path.join(DEFINITIONS_DIR.pathname, name), "utf8");
    assert.match(source, /promptGuidelines/, `${name} is missing promptGuidelines`);
  }
});

test("every tool definition carries the injection-guard guidelines", async () => {
  for (const name of await definitionFiles()) {
    const source = await fs.readFile(path.join(DEFINITIONS_DIR.pathname, name), "utf8");
    assert.match(
      source,
      /INJECTION_GUARD_GUIDELINES/,
      `${name} does not reference INJECTION_GUARD_GUIDELINES`
    );
  }
});
