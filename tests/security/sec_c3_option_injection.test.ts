/**
 * Pentest — Finding C3 (Critical, injection part): option injection through a path argument.
 *
 * `Sandbox.relative(path)` returns a model-supplied string unchanged when it already sits inside
 * the root. A value beginning with "-" therefore reaches `dotnet` / `tsc` / `git` as an OPTION,
 * not a path — e.g. a binary-log switch that writes an arbitrary file, or `--help`-style control
 * of the child process.
 *
 * Secure expectation: a scope path can never be interpreted as an option. The tests FAIL today
 * because `relative()` passes "-bl:…" straight through.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { Sandbox } from "../../src/sandbox/sandbox.ts";

const root = path.resolve("/project");
const sb = new Sandbox(root);

test("C3: relative() must not return an option-shaped scope path", () => {
  for (const evil of ["-bl:/tmp/out.binlog", "--version", "-rf", "-o/tmp/x"]) {
    const out = sb.relative(evil);
    assert.equal(
      out.startsWith("-"),
      false,
      `SECURITY: relative("${evil}") returned "${out}", which a child process reads as an option`
    );
  }
});

test("C3: an option-shaped path should be rejected or neutralised (e.g. ./-bl)", () => {
  // A safe implementation either throws or prefixes with "./" so argv parsing treats it as a path.
  const out = sb.relative("-bl:/tmp/out.binlog");
  assert.ok(
    out.startsWith("./") || out.startsWith("-") === false,
    `SECURITY: expected a neutralised path, got "${out}"`
  );
});
