import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { registerSandboxAuthorizer, teardownSandboxAuthorizer, decideAuthorization } from "../permissionAuthorizer.ts";
import { setSandboxState } from "../sandbox.ts";

const root = path.resolve("/project");

test("decideAuthorization declines everything while sandbox state is off", (t) => {
  t.after(() => setSandboxState("on"));
  setSandboxState("off");

  assert.equal(decideAuthorization(root, { surface: "read", value: "src/index.ts" }), undefined);
});

test("decideAuthorization allows an ordinary in-root path on a known path-shaped surface", (t) => {
  t.after(() => setSandboxState("on"));
  setSandboxState("on");

  assert.equal(decideAuthorization(root, { surface: "read", value: "src/index.ts" }), "allow");
  assert.equal(decideAuthorization(root, { surface: "write", value: "src/index.ts" }), "allow");
  assert.equal(decideAuthorization(root, { surface: "path", value: "src/index.ts" }), "allow");
});

test("decideAuthorization declines a path outside the project root", (t) => {
  t.after(() => setSandboxState("on"));
  setSandboxState("on");

  assert.equal(decideAuthorization(root, { surface: "read", value: "../outside" }), undefined);
});

test("decideAuthorization declines a credential path even though it's inside the root — regression " +
  "test for auto-allowing something this project's own sandbox would itself reject", (t) => {
  t.after(() => setSandboxState("on"));
  setSandboxState("on");

  // .ssh is restricted in read mode too, not just edit — must not be auto-allowed just because
  // it's geometrically inside the project root.
  assert.equal(decideAuthorization(root, { surface: "read", value: ".ssh/id_rsa" }), undefined);
  assert.equal(decideAuthorization(root, { surface: "grep", value: ".ssh/id_rsa" }), undefined);
  // .git is only restricted in edit mode — readable, not writable.
  assert.equal(decideAuthorization(root, { surface: "read", value: ".git/config" }), "allow");
  assert.equal(decideAuthorization(root, { surface: "edit", value: ".git/config" }), undefined);
  // The generic "path" surface doesn't say whether the operation is a read or a write, so it uses
  // the stricter (edit) mode as the conservative default.
  assert.equal(decideAuthorization(root, { surface: "path", value: ".git/config" }), undefined);
});

test("decideAuthorization declines an unknown surface or a missing value", (t) => {
  t.after(() => setSandboxState("on"));
  setSandboxState("on");

  assert.equal(decideAuthorization(root, { surface: "bash", value: "git push" }), undefined);
  assert.equal(decideAuthorization(root, { surface: "read" }), undefined);
});

// @gotgenes/pi-permission-system is intentionally not a dependency of this project (see
// permissionAuthorizer.ts's file header), so these tests exercise the graceful-degradation path —
// the package is guaranteed absent in this repo's node_modules.

test("registerSandboxAuthorizer resolves without throwing when the permission-system package isn't installed", async () => {
  await assert.doesNotReject(() => registerSandboxAuthorizer("/project"));
});

test("teardownSandboxAuthorizer is a no-op when nothing was ever registered", () => {
  assert.doesNotThrow(() => teardownSandboxAuthorizer());
});

test("teardownSandboxAuthorizer after a no-op registration is still safe", async () => {
  await registerSandboxAuthorizer("/project");
  assert.doesNotThrow(() => teardownSandboxAuthorizer());
  // Idempotent — calling it again with nothing left to dispose doesn't throw either.
  assert.doesNotThrow(() => teardownSandboxAuthorizer());
});
