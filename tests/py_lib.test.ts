import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { pyLib } from "../src/tools/py_lib.ts";
import { pyList } from "../src/tools/py_list.ts";
import { findPythonInterpreter, PYTHON_ENV_VAR } from "../src/tools/libInfo/pythonLib.ts";
import { runCommand } from "../src/runCommand.ts";
import { makeFixture, cleanupFixture } from "./fixtures.ts";
import { Sandbox } from "../src/sandbox/sandbox.ts";

const PYTHON = process.platform === "win32" ? "python" : "python3";

async function havePython(): Promise<boolean> {
  try {
    const r = await runCommand(PYTHON, ["-c", "import sys; assert sys.version_info >= (3, 9)"], { cwd: process.cwd() });
    return r.exitCode === 0;
  } catch {
    return false;
  }
}
const SKIP = !(await havePython()) && "python3 (3.9+) not available";

const EXT = process.platform === "win32" ? ".pyd" : ".so";

const SITE = {
  "site/demo_pkg/__init__.py": [
    '"""Demo package for tests.',
    "",
    "More text.",
    '"""',
    "import os",
    "from .core import Client, helper",
    "from .sub import *",
    "from . import sub",
    '__version__ = "1.2.3"',
    "_private = 1",
    "",
  ].join("\n"),
  "site/demo_pkg/core.py": [
    "import os",
    "from typing import Optional",
    "",
    "class Client(object):",
    '    """Talks to the server."""',
    "    timeout: float = 5.0",
    "    def __init__(self, base_url: str, *, retries: int = 3) -> None:",
    '        """Create a client."""',
    "        self.base_url = base_url",
    "    def get(self, path: str, params: Optional[dict] = None) -> bytes:",
    '        """GET a path.',
    "",
    "        :param path: the path",
    '        """',
    "        return b''",
    "    async def stream(self, path):",
    "        yield path",
    "    def _hidden(self):",
    "        pass",
    "    @property",
    "    def name(self) -> str:",
    "        return 'x'",
    "    @name.setter",
    "    def name(self, v): pass",
    "    @classmethod",
    "    def create(cls) -> 'Client':",
    "        return cls('x')",
    "",
    "def helper(x: int, *, flag: bool = False) -> str:",
    '    """Help."""',
    "    return str(x)",
    "",
    "def internal_only():",
    "    pass",
    "",
  ].join("\n"),
  "site/demo_pkg/sub.py": '__all__ = ["subfn"]\n\ndef subfn(a, b=2):\n    """Sub function."""\n\ndef not_exported():\n    pass\n',
  "site/demo_pkg/stubbed.py": "def typed(x):\n    return x\n",
  "site/demo_pkg/stubbed.pyi": "def typed(x: int) -> int: ...\n",
  "site/demo_pkg/_internal.py": "def secret(): pass\n",
  "site/demo_pkg/tests/__init__.py": "",
  "site/demo_pkg-1.2.3.dist-info/METADATA": [
    "Metadata-Version: 2.1",
    "Name: demo-pkg",
    "Version: 1.2.3",
    "Summary: A demo package",
    "Requires-Dist: requests>=2",
    'Requires-Dist: rich; extra == "cli"',
    "",
  ].join("\n"),
  "site/demo_pkg-1.2.3.dist-info/top_level.txt": "demo_pkg\n",
  "site/user_of_demo-0.1.dist-info/METADATA": "Metadata-Version: 2.1\nName: user-of-demo\nVersion: 0.1\nRequires-Dist: demo-pkg\n",
  "site/stubbed_lib/__init__.py": "def f(x):\n    return x\n",
  "site/stubbed_lib-stubs/__init__.pyi": "def f(x: int) -> int: ...\n",
  [`site/fastmod${EXT}`]: "",
  "site/nodist.py": '"""A loose module without metadata."""\n\nfrom typing import NamedTuple\n\nclass Point(NamedTuple):\n    x: int\n    y: int = 0\n',
};

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const dir = await makeFixture(SITE);
  t.after(() => cleanupFixture(dir));
  return { dir, extraSysPath: [path.join(dir, "site")] };
}

test("overview: dist metadata, submodules, re-exports, no private names", { skip: SKIP }, async (t) => {
  const { dir, extraSysPath } = await fixture(t);
  const r = await pyLib(new Sandbox(dir), "demo-pkg", { extraSysPath });
  assert.match(r.text, /^demo-pkg 1\.2\.3 \(python\)/);
  assert.match(r.text, /Summary: A demo package/);
  assert.match(r.text, /Dependencies: requests>=2, \(\+1 optional extras\)/);
  assert.match(r.text, /Modules: demo_pkg\.core, demo_pkg\.stubbed, demo_pkg\.sub\n/); // no _internal, no tests
  assert.match(r.text, /class Client\(object\)\s+\(\+\d+ members\)/);
  assert.match(r.text, /def helper\(x: int, \*, flag: bool=False\) -> str/);
  assert.match(r.text, /def subfn\(a, b=2\)/); // via star import honoring sub.__all__
  assert.match(r.text, /module demo_pkg\.sub/);
  assert.match(r.text, /__version__ = '1\.2\.3'/);
  assert.doesNotMatch(r.text, /not_exported|internal_only|_private|\bos\b/);
});

test("import name and pip name both work", { skip: SKIP }, async (t) => {
  const { dir, extraSysPath } = await fixture(t);
  const r = await pyLib(new Sandbox(dir), "demo_pkg", { extraSysPath });
  assert.match(r.text, /^demo-pkg 1\.2\.3/);
});

test("symbol view: class with members, docs, decorators; private hidden", { skip: SKIP }, async (t) => {
  const { dir, extraSysPath } = await fixture(t);
  const r = await pyLib(new Sandbox(dir), "demo_pkg", { symbol: "Client", extraSysPath });
  assert.match(r.text, /Talks to the server\./);
  assert.match(r.text, /Re-exported from: demo_pkg\.core/);
  assert.match(r.text, /def __init__\(self, base_url: str, \*, retries: int=3\) -> None/);
  assert.match(r.text, /async def stream\(self, path\)/);
  assert.match(r.text, /@property def name\(self\) -> str/);
  assert.match(r.text, /@classmethod def create\(cls\) -> 'Client'/);
  assert.match(r.text, /timeout: float = 5\.0/);
  assert.doesNotMatch(r.text, /_hidden/);
  assert.equal((r.text.match(/def name\(/g) ?? []).length, 1); // setter skipped

  const m = await pyLib(new Sandbox(dir), "demo_pkg", { symbol: "Client.get", extraSysPath });
  assert.match(m.text, /:param path: the path/);
  assert.match(m.text, /Source: site\/demo_pkg\/core\.py:10/);

  const priv = await pyLib(new Sandbox(dir), "demo_pkg", { symbol: "Client", includePrivate: true, extraSysPath });
  assert.match(priv.text, /_hidden/);
});

test("dotted symbols and module= select submodules", { skip: SKIP }, async (t) => {
  const { dir, extraSysPath } = await fixture(t);
  for (const opts of [{ symbol: "demo_pkg.core.internal_only" }, { symbol: "core.internal_only" }, { module: "demo_pkg.core", symbol: "internal_only" }, { module: "core", symbol: "internal_only" }]) {
    const r = await pyLib(new Sandbox(dir), "demo_pkg", { ...opts, extraSysPath });
    assert.match(r.text, /module demo_pkg\.core/, JSON.stringify(opts));
    assert.match(r.text, /== internal_only/, JSON.stringify(opts));
  }
});

test(".pyi stubs win over .py, and <pkg>-stubs packages over inline sources", { skip: SKIP }, async (t) => {
  const { dir, extraSysPath } = await fixture(t);
  const inline = await pyLib(new Sandbox(dir), "demo_pkg", { module: "demo_pkg.stubbed", extraSysPath });
  assert.match(inline.text, /def typed\(x: int\) -> int/);
  assert.match(inline.text, /\.pyi stub/);

  const pkg = await pyLib(new Sandbox(dir), "stubbed_lib", { extraSysPath });
  assert.match(pkg.text, /def f\(x: int\) -> int/);
  assert.match(pkg.text, /stubbed_lib-stubs package/);
});

test("compiled modules without stubs are reported, not imported", { skip: SKIP }, async (t) => {
  const { dir, extraSysPath } = await fixture(t);
  const r = await pyLib(new Sandbox(dir), "fastmod", { extraSysPath });
  assert.match(r.text, /compiled extension module/);
  assert.match(r.text, /No public API entries found/);
});

test("loose modules and NamedTuple fields; stdlib works", { skip: SKIP }, async (t) => {
  const { dir, extraSysPath } = await fixture(t);
  const r = await pyLib(new Sandbox(dir), "nodist", { symbol: "Point", extraSysPath });
  assert.match(r.text, /class Point\(NamedTuple\)/);
  assert.match(r.text, /y: int = 0/);

  const json = await pyLib(new Sandbox(dir), "json", { symbol: "dumps", extraSysPath });
  assert.match(json.text, /json stdlib, Python 3/);
  assert.match(json.text, /def dumps\(obj/);
});

test("errors: unknown package, invalid names, unknown module", { skip: SKIP }, async (t) => {
  const { dir, extraSysPath } = await fixture(t);
  await assert.rejects(() => pyLib(new Sandbox(dir), "no-such-package-xyz", { extraSysPath }), /not installed.*py_list/);
  await assert.rejects(() => pyLib(new Sandbox(dir), "../etc", { extraSysPath }), /not a valid Python package/);
  await assert.rejects(() => pyLib(new Sandbox(dir), "demo_pkg", { module: "../x", extraSysPath }), /not a valid dotted module name/);
  await assert.rejects(() => pyLib(new Sandbox(dir), "demo_pkg", { module: "demo_pkg.nope", extraSysPath }), /Module "demo_pkg\.nope" not found/);
});

test("py_list lists distributions and shows details for an exact name", { skip: SKIP }, async (t) => {
  const { dir, extraSysPath } = await fixture(t);
  const all = await pyList(new Sandbox(dir), { package: "demo", extraSysPath });
  assert.match(all.text, /demo-pkg==1\.2\.3 {2}— A demo package/);
  assert.match(all.text, /user-of-demo==0\.1/);

  const one = await pyList(new Sandbox(dir), { package: "demo_pkg", extraSysPath });
  assert.match(one.text, /^demo-pkg 1\.2\.3$/m);
  assert.match(one.text, /Import as: demo_pkg/);
  assert.match(one.text, /Requires: requests>=2 \(\+1 optional extras\)/);
  assert.match(one.text, /Required by: user-of-demo/);

  const none = await pyList(new Sandbox(dir), { package: "zzz-nothing", extraSysPath });
  assert.match(none.text, /No installed package matches/);
});

test("findPythonInterpreter precedence: env var, VIRTUAL_ENV, project venv, PATH", async (t) => {
  const dir = await makeFixture({ ".venv/bin/python3": "", "other/bin/python3": "", ".venv/Scripts/python.exe": "", "other/Scripts/python.exe": "" });
  t.after(() => cleanupFixture(dir));

  assert.deepEqual(findPythonInterpreter(dir, { [PYTHON_ENV_VAR]: "/opt/py" }), { command: "/opt/py", reason: `$${PYTHON_ENV_VAR}` });
  assert.equal(findPythonInterpreter(dir, { VIRTUAL_ENV: path.join(dir, "other") }).reason, "$VIRTUAL_ENV");
  assert.equal(findPythonInterpreter(dir).reason, "project .venv");
  await fs.rm(path.join(dir, ".venv"), { recursive: true });
  assert.equal(findPythonInterpreter(dir).reason, "PATH");
});

test("rejects when the signal is already aborted", { skip: SKIP }, async (t) => {
  const { dir, extraSysPath } = await fixture(t);
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(() => pyLib(new Sandbox(dir), "demo_pkg", { extraSysPath, signal: ac.signal }), { name: "AbortError" });
});
