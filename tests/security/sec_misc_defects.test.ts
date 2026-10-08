/**
 * Pentest — remaining findings that are their own small defects.
 *
 *  L9: `dotnet_build` does not check an already-aborted signal before spawning, so a cancelled
 *      call still launches a build. (This is also the one currently-failing test in the main
 *      suite.)
 *  D3: `find_usages` with language "auto" throws when a project has more than one language marker
 *      (e.g. a TypeScript repo that also has a Python `.venv`), so the tool is unusable there.
 *
 * Both assert the intended behaviour and FAIL today. L9 skips when dotnet is installed, because
 * an installed dotnet makes the pre-spawn abort indistinguishable from a normal fast failure in
 * this black-box test; it reproduces deterministically when dotnet is absent (the common case).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { Sandbox } from "../../src/sandbox/sandbox.ts";
import { dotnetBuild } from "../../src/tools/dotnet_build.ts";
import { findUsages } from "../../src/tools/find_usages.ts";
import { makeFixture, cleanupFixture } from "../fixtures.ts";

test("L9: dotnet_build must reject immediately when the signal is already aborted", async (t) => {
  let hasDotnet = false;
  try {
    execFileSync("dotnet", ["--version"], { stdio: "ignore" });
    hasDotnet = true;
  } catch {
    hasDotnet = false;
  }
  if (hasDotnet) {
    t.skip("dotnet present: pre-spawn abort not observable in this black-box test");
    return;
  }
  const root = await makeFixture({});
  try {
    const sb = new Sandbox(root); // sandbox ON
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      () => dotnetBuild(sb, { signal: controller.signal }),
      (err: unknown) => (err as Error).name === "AbortError",
      "BUG: dotnet_build did not honour an already-aborted signal before spawning"
    );
  } finally {
    await cleanupFixture(root);
  }
});

test("D3: find_usages (auto) must handle a project with more than one language marker", async () => {
  const root = await makeFixture({
    "node_modules/.package-lock.json": "{}\n", // TypeScript marker
    ".venv/pyvenv.cfg": "home = /usr\n", // Python marker
    "src/app.ts": "export function doThing() {}\ndoThing();\n",
  });
  try {
    const sb = new Sandbox(root); // sandbox ON
    // Should not throw just because two ecosystems coexist in one repo.
    const result = await findUsages(sb, ".", "doThing", "auto");
    assert.ok(
      result.matches.length >= 1,
      "BUG: find_usages auto refused a mixed-language project instead of detecting a usable language"
    );
  } finally {
    await cleanupFixture(root);
  }
});
