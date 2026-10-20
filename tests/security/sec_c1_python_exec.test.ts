/**
 * Pentest — Finding C1 (Critical): Python tools execute model-written code with the sandbox ON.
 *
 * `findPythonInterpreter` prefers the project's own `.venv`, and `runPyHelper` runs it with `-I`.
 * Isolated mode still runs the `site` module, which processes `.pth` files in site-packages; both
 * the `.pth` file and the interpreter binary are writable through this extension's own `write`/
 * `copy` tools. A hijacked model can therefore gain code execution without the sandbox ever
 * being turned off.
 *
 * These tests assert the SECURE expectation (no code runs). They FAIL against the current code,
 * which runs the planted code. Payloads are benign: they only `touch` a marker file in the
 * test's own temp dir to prove execution happened.
 *
 * Skips when python3 / `venv` is unavailable (same policy as the dotnet tests).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { Sandbox } from "../../src/sandbox/sandbox.ts";
import { writeFile } from "../../src/tools/write.ts";
import { copyFile } from "../../src/tools/copy.ts";
import { pyList } from "../../src/tools/py_list.ts";
import { makeFixture, cleanupFixture } from "../fixtures.ts";

function makeVenv(root: string, t: { skip(msg: string): void }): { site: string } | undefined {
  const venv = path.join(root, ".venv");
  try {
    execFileSync("python3", ["-m", "venv", "--without-pip", venv], { stdio: "ignore" });
  } catch (err) {
    t.skip(`python3 venv unavailable: ${(err as Error).message}`);
    return undefined;
  }
  const site = execFileSync(path.join(venv, "bin", "python3"), [
    "-c",
    "import sysconfig;print(sysconfig.get_paths()['purelib'])",
  ])
    .toString()
    .trim();
  return { site };
}

test("C1: a .pth file planted in the project .venv must not execute when py_list runs", async (t) => {
  const root = await makeFixture({ "pyproject.toml": "[project]\nname='x'\n" });
  try {
    const venv = makeVenv(root, t);
    if (!venv) return;

    const marker = path.join(root, "PTH_CODE_RAN.marker");
    const sb = new Sandbox(root); // sandbox ON (enforced)
    // A model with only this extension's tools can write this file today.
    await writeFile(
      sb,
      path.relative(root, path.join(venv.site, "zz_pentest.pth")),
      `import os; open(${JSON.stringify(marker)}, "w").close()\n`
    );

    await pyList(sb, {}).catch(() => {});

    assert.equal(
      fs.existsSync(marker),
      false,
      "SECURITY: a .pth file in the project venv executed arbitrary code during py_list"
    );
  } finally {
    await cleanupFixture(root);
  }
});

test("C1: a model-replaced .venv interpreter must not be executed by py_list", async (t) => {
  const root = await makeFixture({ "scripts/tool.sh": "#!/bin/sh\necho ok\n" });
  try {
    if (process.platform === "win32") {
      t.skip("POSIX interpreter-shim scenario");
      return;
    }
    const marker = path.join(root, "INTERP_RAN.marker");
    // A committed helper script in a repo is typically executable; make the source +x so the
    // scenario matches reality (copy preserves the bit, write keeps it on overwrite).
    fs.chmodSync(path.join(root, "scripts/tool.sh"), 0o755);
    const sb = new Sandbox(root);

    // copy preserves the executable bit, write then overwrites the contents keeping that bit —
    // both are plain uses of this extension's tools, sandbox ON.
    await copyFile(sb, "scripts/tool.sh", ".venv/bin/python3");
    await writeFile(sb, ".venv/bin/python3", `#!/bin/sh\n: > ${marker}\necho '{"error":"x"}'\n`);

    await pyList(sb, {}).catch(() => {});

    assert.equal(
      fs.existsSync(marker),
      false,
      "SECURITY: py_list executed a model-planted interpreter at .venv/bin/python3"
    );
  } finally {
    await cleanupFixture(root);
  }
});
