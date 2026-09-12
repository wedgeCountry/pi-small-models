import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  DEFAULT_IGNORE_GLOBS,
  GLOBAL_IGNORE_FILENAME,
  LOCAL_IGNORE_FILENAME,
  appendGlobalIgnorePattern,
  getEffectiveIgnoreGlobs,
  getGlobalIgnorePath,
  getLocalIgnorePath,
  loadCustomIgnoreGlobs,
  readIgnoreFile,
} from "../ignore.ts";
import { makeFixture, cleanupFixture } from "./fixtures.ts";

test("getLocalIgnorePath / getGlobalIgnorePath join the filename onto the given root", async () => {
  assert.equal(getLocalIgnorePath(path.join("project", "root")), path.join("project", "root", LOCAL_IGNORE_FILENAME));
  assert.equal(getGlobalIgnorePath(path.join("agent", "dir")), path.join("agent", "dir", GLOBAL_IGNORE_FILENAME));
});

test("readIgnoreFile returns an empty array when the file does not exist", async (t) => {
  const dir = await makeFixture({});
  t.after(() => cleanupFixture(dir));

  const result = await readIgnoreFile(path.join(dir, "nope"));
  assert.deepEqual(result, []);
});

test("readIgnoreFile skips blank lines and # comments", async (t) => {
  const dir = await makeFixture({
    ignore: "# a comment\n\n*.log\n   \ndist/**\n# another comment\n",
  });
  t.after(() => cleanupFixture(dir));

  const result = await readIgnoreFile(path.join(dir, "ignore"));
  assert.deepEqual(result, ["*.log", "dist/**"]);
});

test("readIgnoreFile trims surrounding whitespace and handles CRLF line endings", async (t) => {
  const dir = await makeFixture({});
  t.after(() => cleanupFixture(dir));
  const filePath = path.join(dir, "ignore");
  await fs.writeFile(filePath, "  *.tmp  \r\n*.bak\r\n", "utf8");

  const result = await readIgnoreFile(filePath);
  assert.deepEqual(result, ["*.tmp", "*.bak"]);
});

test("loadCustomIgnoreGlobs merges global and local patterns, de-duplicated", async (t) => {
  const agentDir = await makeFixture({ [GLOBAL_IGNORE_FILENAME]: "*.log\nshared/**\n" });
  const root = await makeFixture({ [LOCAL_IGNORE_FILENAME]: "shared/**\n*.bak\n" });
  t.after(() => Promise.all([cleanupFixture(agentDir), cleanupFixture(root)]));

  const result = await loadCustomIgnoreGlobs(root, agentDir);
  assert.deepEqual(result, ["*.log", "shared/**", "*.bak"]);
});

test("loadCustomIgnoreGlobs returns an empty array when neither ignore file exists", async (t) => {
  const agentDir = await makeFixture({});
  const root = await makeFixture({});
  t.after(() => Promise.all([cleanupFixture(agentDir), cleanupFixture(root)]));

  const result = await loadCustomIgnoreGlobs(root, agentDir);
  assert.deepEqual(result, []);
});

test("getEffectiveIgnoreGlobs layers custom patterns on top of the hardcoded defaults", async (t) => {
  const agentDir = await makeFixture({ [GLOBAL_IGNORE_FILENAME]: "*.log\n" });
  const root = await makeFixture({ [LOCAL_IGNORE_FILENAME]: "*.bak\n" });
  t.after(() => Promise.all([cleanupFixture(agentDir), cleanupFixture(root)]));

  const result = await getEffectiveIgnoreGlobs(root, agentDir);
  assert.deepEqual(result, [...DEFAULT_IGNORE_GLOBS, "*.log", "*.bak"]);
});

test("appendGlobalIgnorePattern creates the agent dir and ignore file on first use", async (t) => {
  const parent = await makeFixture({});
  t.after(() => cleanupFixture(parent));
  const agentDir = path.join(parent, "agent");

  const result = await appendGlobalIgnorePattern(agentDir, "*.log");
  assert.equal(result.added, true);

  const content = await fs.readFile(getGlobalIgnorePath(agentDir), "utf8");
  assert.equal(content, "*.log\n");
});

test("appendGlobalIgnorePattern appends onto an existing file, inserting a newline first if the file lacked one", async (t) => {
  const agentDir = await makeFixture({ [GLOBAL_IGNORE_FILENAME]: "*.log" }); // no trailing newline
  t.after(() => cleanupFixture(agentDir));

  const result = await appendGlobalIgnorePattern(agentDir, "*.bak");
  assert.equal(result.added, true);

  const content = await fs.readFile(getGlobalIgnorePath(agentDir), "utf8");
  assert.equal(content, "*.log\n*.bak\n");
});

test("appendGlobalIgnorePattern is a no-op when the pattern is already present", async (t) => {
  const agentDir = await makeFixture({ [GLOBAL_IGNORE_FILENAME]: "*.log\n" });
  t.after(() => cleanupFixture(agentDir));

  const result = await appendGlobalIgnorePattern(agentDir, "*.log");
  assert.equal(result.added, false);

  const content = await fs.readFile(getGlobalIgnorePath(agentDir), "utf8");
  assert.equal(content, "*.log\n"); // unchanged, no duplicate line appended
});

test("appendGlobalIgnorePattern serializes concurrent appends onto the same file instead of losing one", async (t) => {
  const agentDir = await makeFixture({});
  t.after(() => cleanupFixture(agentDir));

  await Promise.all([appendGlobalIgnorePattern(agentDir, "*.log"), appendGlobalIgnorePattern(agentDir, "*.bak")]);

  const patterns = await readIgnoreFile(getGlobalIgnorePath(agentDir));
  assert.deepEqual(patterns.sort(), ["*.bak", "*.log"]);
});
