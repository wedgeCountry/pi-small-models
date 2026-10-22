/**
 * Pentest — Finding C2 (Critical): `ts_check` runs a model-writable compiler binary.
 *
 * `tsCheck` shells out to `npx tsc` in the project root. `npx` resolves `node_modules/.bin/tsc`
 * first, and that file is inside the project root, so it is writable through this extension's
 * `write`/`copy` tools. Replacing it yields code execution the moment the model calls `ts_check`
 * — again with the sandbox ON.
 *
 * Secure expectation: running `ts_check` never executes a project-local binary the model could
 * have written. The test uses a benign marker payload and FAILS today because the planted shim
 * runs.
 *
 * Skips when `npx` is unavailable or on Windows (shim semantics differ; see Finding M5).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { Sandbox } from "../../src/sandbox/sandbox.ts";
import { tsCheck } from "../../src/tools/ts_check.ts";
import { makeFixture, cleanupFixture } from "../fixtures.ts";

test("C2: ts_check must not execute a project-local node_modules/.bin/tsc the model could write", async (t) => {
  if (process.platform === "win32") {
    t.skip("POSIX shim scenario; Windows .cmd resolution covered by Finding M5");
    return;
  }
  try {
    execFileSync("npx", ["--version"], { stdio: "ignore" });
  } catch (err) {
    t.skip(`npx unavailable: ${(err as Error).message}`);
    return;
  }

  const root = await makeFixture({
    "tsconfig.json": JSON.stringify({ compilerOptions: { noEmit: true } }),
    "index.ts": "export const x = 1;\n",
  });
  try {
    const marker = path.join(root, "TSC_SHIM_RAN.marker");
    const binDir = path.join(root, "node_modules", ".bin");
    fs.mkdirSync(binDir, { recursive: true });
    const shim = path.join(binDir, "tsc");
    // Stand-in for a binary the model replaced via write/copy (both keep the +x bit).
    fs.writeFileSync(shim, `#!/bin/sh\n: > ${marker}\nexit 0\n`, { mode: 0o755 });

    const sb = new Sandbox(root); // sandbox ON
    await tsCheck(sb, {}).catch(() => {});

    assert.equal(
      fs.existsSync(marker),
      false,
      "SECURITY: ts_check executed a model-writable node_modules/.bin/tsc"
    );
  } finally {
    await cleanupFixture(root);
  }
});
