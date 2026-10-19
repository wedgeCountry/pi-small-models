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
import { Sandbox } from "../../src/sandbox/sandbox.ts";
import { findUsages } from "../../src/tools/find_usages.ts";
import { makeFixture, cleanupFixture } from "../fixtures.ts";

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
