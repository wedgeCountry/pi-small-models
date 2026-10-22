/**
 * Pentest — Finding M2 (Medium): library roots are derived from model-writable metadata.
 *
 * `py_lib` allows reads outside the project root because the roots come from the interpreter's
 * `sys.path`. A path-only line in a `.pth` file (no code, so distinct from C1) adds any directory
 * to `sys.path`; the extension then treats that directory as a legitimate library root and will
 * summarise `.py`/`.pyi` source it finds there — reading files from outside the project root.
 *
 * Secure expectation: naming a module that only resolves via a model-planted sys.path entry does
 * not read source from outside the project root. FAILS today. Skips without python3/venv.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { Sandbox } from "../../src/sandbox/sandbox.ts";
import { pyLib } from "../../src/tools/py_lib.ts";
import { makeFixture, cleanupFixture } from "../fixtures.ts";

test("M2: py_lib must not read source from a directory added via a model-written .pth path entry", async (t) => {
  const root = await makeFixture({ "pyproject.toml": "[project]\nname='x'\n" });
  // A directory OUTSIDE the project root holding a module we should never be able to read.
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "pi-outside-"));
  try {
    const venv = path.join(root, ".venv");
    try {
      execFileSync("python3", ["-m", "venv", "--without-pip", venv], { stdio: "ignore" });
    } catch (err) {
      t.skip(`python3 venv unavailable: ${(err as Error).message}`);
      return;
    }
    const site = execFileSync(path.join(venv, "bin", "python3"), [
      "-c",
      "import sysconfig;print(sysconfig.get_paths()['purelib'])",
    ])
      .toString()
      .trim();

    const SENTINEL = "def leaked_private_api():\n    return 'OUTSIDE-ROOT-SOURCE'\n";
    fs.writeFileSync(path.join(outside, "secret_pkg.py"), SENTINEL);
    // Path-only .pth line (not executable code) that bolts the outside dir onto sys.path.
    fs.writeFileSync(path.join(site, "zz_pentest_path.pth"), outside + "\n");

    const sb = new Sandbox(root); // sandbox ON
    const result = await pyLib(sb, "secret_pkg", {}).catch((err: Error) => ({ text: `ERROR: ${err.message}` }));

    assert.equal(
      result.text.includes("leaked_private_api"),
      false,
      "SECURITY: py_lib summarised source from outside the project root via a .pth sys.path entry"
    );
  } finally {
    await cleanupFixture(root);
    fs.rmSync(outside, { recursive: true, force: true });
  }
});
