import { test } from "node:test";
import assert from "node:assert/strict";
import { capText, capLines, capHint, DEFAULT_MAX_LINES, DEFAULT_MAX_BYTES, uncappedParam } from "../src/backend/capOutput.ts";
import { readFile } from "../src/tools/read.ts";
import { Sandbox } from "../src/sandbox/sandbox.ts";
import { makeFixture, cleanupFixture } from "./fixtures.ts";
import { READ_TOOL_DEFINITION } from "../src/tool_definitions/read.ts";
import { PEEK_TOOL_DEFINITION } from "../src/tool_definitions/peek.ts";
import { GREP_TOOL_DEFINITION } from "../src/tool_definitions/grep.ts";
import { FIND_TOOL_DEFINITION } from "../src/tool_definitions/find.ts";
import { FIND_USAGES_TOOL_DEFINITION } from "../src/tool_definitions/find_usages.ts";
import { LIST_TOOL_DEFINITION } from "../src/tool_definitions/list.ts";
import { GIT_STATUS_TOOL_DEFINITION } from "../src/tool_definitions/git_status.ts";
import { GIT_DIFF_TOOL_DEFINITION } from "../src/tool_definitions/git_diff.ts";
import { GIT_LOG_TOOL_DEFINITION } from "../src/tool_definitions/git_log.ts";
import { PI_DOCS_TOOL_DEFINITION } from "../src/tool_definitions/pi_docs.ts";
import { PI_SKILLS_TOOL_DEFINITION } from "../src/tool_definitions/pi_skills.ts";

test("capText passes short text through untouched", () => {
  const { text, truncated } = capText("a\nb\nc");
  assert.equal(text, "a\nb\nc");
  assert.equal(truncated, false);
});

test("capText caps by line count", () => {
  const input = Array.from({ length: DEFAULT_MAX_LINES + 500 }, (_, i) => `line ${i}`).join("\n");
  const { text, truncated } = capText(input);
  assert.equal(truncated, true);
  assert.equal(text.split("\n").length, DEFAULT_MAX_LINES);
});

test("capText caps by bytes, trimming whole lines only", () => {
  const longLine = "x".repeat(DEFAULT_MAX_BYTES); // one line bigger than the byte cap
  const { text, truncated } = capText(`short\n${longLine}\nshort`);
  assert.equal(truncated, true);
  assert.equal(text, "short");
});

test("capText with uncapped returns the full text", () => {
  const input = Array.from({ length: DEFAULT_MAX_LINES + 500 }, (_, i) => `line ${i}`).join("\n");
  const { text, truncated } = capText(input, { uncapped: true });
  assert.equal(truncated, false);
  assert.equal(text, input);
});

test("capHint names the cap and the opt-out parameter", () => {
  assert.match(capHint(), /uncapped: true/);
});

test("capLines caps by line count and by bytes, always keeping at least one item", () => {
  const many = Array.from({ length: DEFAULT_MAX_LINES + 10 }, (_, i) => `line ${i}`);
  const byLines = capLines(many);
  assert.equal(byLines.truncated, true);
  assert.equal(byLines.items.length, DEFAULT_MAX_LINES);

  const big = ["short", "x".repeat(DEFAULT_MAX_BYTES), "short"];
  const byBytes = capLines(big);
  assert.equal(byBytes.truncated, true);
  assert.deepEqual(byBytes.items, ["short"]);

  const singleHuge = capLines(["x".repeat(DEFAULT_MAX_BYTES * 2)]);
  assert.equal(singleHuge.truncated, false, "a single oversized line is kept whole");
  assert.equal(singleHuge.items.length, 1);
});

test("capLines with uncapped or a custom sizeOf", () => {
  const items = [{ text: "a" }, { text: "b" }];
  assert.equal(capLines(items, { uncapped: true }).truncated, false);
  const sized = capLines(items, { maxBytes: 2, sizeOf: (i) => i.text.length + 1 });
  assert.deepEqual(sized.items, [{ text: "a" }]);
  assert.equal(sized.truncated, true);
});

test("read caps at 2000 lines by default and honors the uncapped opt-out", async (t) => {
  const dir = await makeFixture({ "big.txt": Array.from({ length: 2500 }, (_, i) => `line ${i}`).join("\n") + "\n" });
  t.after(() => cleanupFixture(dir));
  const sb = new Sandbox(dir);

  const capped = await readFile(sb, "big.txt");
  assert.equal(capped.lines.length, DEFAULT_MAX_LINES);
  assert.equal(capped.truncated, true);

  const full = await readFile(sb, "big.txt", { uncapped: true });
  assert.equal(full.lines.length, 2501); // 2500 lines plus the trailing-newline empty line
  assert.equal(full.truncated, false);
});

test("every content-returning tool definition exposes the uncapped parameter", () => {
  const definitions = [
    READ_TOOL_DEFINITION,
    PEEK_TOOL_DEFINITION,
    GREP_TOOL_DEFINITION,
    FIND_TOOL_DEFINITION,
    FIND_USAGES_TOOL_DEFINITION,
    LIST_TOOL_DEFINITION,
    GIT_STATUS_TOOL_DEFINITION,
    GIT_DIFF_TOOL_DEFINITION,
    GIT_LOG_TOOL_DEFINITION,
    PI_DOCS_TOOL_DEFINITION,
    PI_SKILLS_TOOL_DEFINITION,
  ];
  for (const def of definitions) {
    const params = def.parameters as { properties?: Record<string, unknown> };
    assert.ok(params.properties && "uncapped" in params.properties, `${def.name} has no uncapped parameter`);
  }
  assert.ok(uncappedParam, "shared uncapped schema fragment exists");
});
