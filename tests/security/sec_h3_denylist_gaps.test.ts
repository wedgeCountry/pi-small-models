/**
 * Pentest — Finding H3 (High): credential denylist gaps, and $HOME as the project root.
 *
 * `RESTRICTED_GLOBS` lists 15 patterns; anything not listed is readable. Several common
 * credential stores are missing, and if Pi is started in the home directory the whole of $HOME
 * (including Pi's own `~/.pi/agent/auth.json`, shell history and browser profiles) falls inside
 * the root and is readable.
 *
 * Secure expectation: the gap files are restricted, and a sandbox rooted at the user's home
 * directory refuses to operate. These FAIL today.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as os from "node:os";
import { isRestricted } from "../../src/sandbox/policy.ts";
import { Sandbox } from "../../src/sandbox/sandbox.ts";

// Credential / secret-bearing files a real project can contain that the current list misses.
const SHOULD_BE_RESTRICTED = [
  ".git-credentials",
  ".pypirc",
  ".yarnrc.yml",
  ".config/gh/hosts.yml", // GitHub CLI OAuth token
  "server.pem",
  "private.key",
  "keystore.p12",
  "terraform.tfstate", // often contains secrets in plaintext
  ".terraform/terraform.tfstate",
];

for (const rel of SHOULD_BE_RESTRICTED) {
  test(`H3: "${rel}" should be treated as a protected secret`, () => {
    assert.equal(
      isRestricted(rel),
      true,
      `SECURITY: "${rel}" is readable/writable — it holds credentials and should be on the denylist`
    );
  });
}

test("H3: a sandbox rooted at the user's home directory must refuse to operate", () => {
  const home = os.homedir();
  const sb = new Sandbox(home); // enforced
  // With $HOME as root, ~/.bashrc, ~/.pi/agent/auth.json, ~/.mozilla, etc. are all "inside root".
  assert.throws(
    () => sb.resolve(".bashrc"),
    "SECURITY: the sandbox allowed access under $HOME; home/filesystem roots should be rejected"
  );
});
