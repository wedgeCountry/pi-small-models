import { test } from "node:test";
import assert from "node:assert/strict";
import { Type } from "typebox";
import { withConciseValidationErrors } from "../src/toolValidation.ts";

const SCHEMA = Type.Object({
  path: Type.String(),
  maxResults: Type.Optional(Type.Integer()),
  flag: Type.Optional(Type.Boolean()),
});

test("passes valid arguments through unchanged", () => {
  const prepare = withConciseValidationErrors("my_tool", SCHEMA);
  const args = { path: "a.ts", maxResults: 5 };
  assert.deepEqual(prepare(args), args);
});

test("reports a missing required property without dumping the full raw arguments", () => {
  const prepare = withConciseValidationErrors("my_tool", SCHEMA);
  assert.throws(
    () => prepare({ maxResults: 5 }),
    (err: Error) => {
      assert.match(err.message, /Validation failed for tool "my_tool":/);
      assert.match(err.message, /path: must have required properties path/);
      assert.match(err.message, /Received argument names: maxResults/);
      // The missing property was never received, so no value line for it.
      assert.doesNotMatch(err.message, /^path: /m);
      return true;
    }
  );
});

test("includes the value of an argument a validation error actually names", () => {
  const prepare = withConciseValidationErrors("my_tool", SCHEMA);
  assert.throws(
    () => prepare({ path: "a.ts", maxResults: "not-a-number" }),
    (err: Error) => {
      assert.match(err.message, /maxResults: must be integer/);
      assert.match(err.message, /Received argument names: path, maxResults/);
      assert.match(err.message, /^maxResults: "not-a-number"$/m);
      // The unrelated "path" argument's value isn't echoed back.
      assert.doesNotMatch(err.message, /^path: "a\.ts"$/m);
      return true;
    }
  );
});

test("omits the received-argument-names line when no arguments were sent", () => {
  const prepare = withConciseValidationErrors("my_tool", SCHEMA);
  assert.throws(
    () => prepare({}),
    (err: Error) => {
      assert.doesNotMatch(err.message, /Received argument names/);
      return true;
    }
  );
});
