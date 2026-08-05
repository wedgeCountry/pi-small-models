import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { removePath } from "../src/tools/remove.ts";
import { makeFixture, cleanupFixture } from "./fixtures.ts";

test("removes a file", async (t) => {
  const dir = await makeFixture({ "a.txt": "" });
  t.after(() => cleanupFixture(dir));

  await removePath(path.join(dir, "a.txt"));
  await assert.rejects(() => fs.stat(path.join(dir, "a.txt")));
});

test("rejects removing a directory without recursive", async (t) => {
  const dir = await makeFixture({ "sub/a.txt": "" });
  t.after(() => cleanupFixture(dir));

  await assert.rejects(() => removePath(path.join(dir, "sub")));
  const stat = await fs.stat(path.join(dir, "sub"));
  assert.ok(stat.isDirectory());
});

test("removes a directory and its contents when recursive is set", async (t) => {
  const dir = await makeFixture({ "sub/a.txt": "", "sub/nested/b.txt": "" });
  t.after(() => cleanupFixture(dir));

  await removePath(path.join(dir, "sub"), { recursive: true });
  await assert.rejects(() => fs.stat(path.join(dir, "sub")));
});

test("rejects when the path does not exist", async (t) => {
  const dir = await makeFixture({});
  t.after(() => cleanupFixture(dir));

  await assert.rejects(() => removePath(path.join(dir, "missing.txt")));
});

test("rejects when the signal is already aborted, without removing anything", async (t) => {
  const dir = await makeFixture({ "a.txt": "" });
  t.after(() => cleanupFixture(dir));

  const ac = new AbortController();
  ac.abort();
  await assert.rejects(() => removePath(path.join(dir, "a.txt"), { signal: ac.signal }));
  const stat = await fs.stat(path.join(dir, "a.txt"));
  assert.ok(stat.isFile());
});

test("aborts a recursive removal in flight via signal, leaving it intact", async (t) => {
  const dir = await makeFixture({ "sub/a.txt": "", "sub/nested/b.txt": "" });
  t.after(() => cleanupFixture(dir));

  const ac = new AbortController();
  const promise = removePath(path.join(dir, "sub"), { recursive: true, signal: ac.signal });
  ac.abort();
  await assert.rejects(() => promise);
  const stat = await fs.stat(path.join(dir, "sub"));
  assert.ok(stat.isDirectory());
});
