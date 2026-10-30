import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { registerReadTool } from "../src/tools/read.ts";
import { registerGrepTool } from "../src/tools/grep.ts";
import { registerFindTool } from "../src/tools/find.ts";
import { registerFindUsagesTool } from "../src/tools/find_usages.ts";
import { registerListTool } from "../src/tools/list.ts";
import { registerLstatTool } from "../src/tools/lstat.ts";
import { registerGitStatusTool } from "../src/tools/git_status.ts";
import { registerGitLogTool } from "../src/tools/git_log.ts";
import { registerGitDiffTool } from "../src/tools/git_diff.ts";
import { registerWriteTool } from "../src/tools/write.ts";
import { registerMkdirTool } from "../src/tools/mkdir.ts";
import { registerCopyTool } from "../src/tools/copy.ts";
import { registerMoveTool } from "../src/tools/move.ts";
import { registerRemoveTool } from "../src/tools/remove.ts";
import { registerInsertTool } from "../src/tools/insert.ts";
import { registerEditTool } from "../src/tools/edit.ts";
import { makeFixture, cleanupFixture, initGitRepo } from "./fixtures.ts";
import { escapeTripleBackticks } from "../src/backend/escapeBackticks.ts";

/**
 * Every tool must escape triple backticks in its returned text: a file (or path, or commit
 * message) that contains ``` would otherwise break out of — or into — a markdown code block in
 * the model's transcript. Each case below drives the registered tool's `execute()` against
 * content that contains triple backticks, and asserts the returned text holds no literal ``` .
 */

const FENCE = "```";
const FENCED_CONTENT = `${FENCE}js\nconst foo = 1;\n${FENCE}\n`;

type Execute = (
  toolCallId: string,
  params: Record<string, unknown>,
  signal?: AbortSignal,
  onUpdate?: unknown,
  ctx?: { cwd: string },
) => Promise<{ content: { type: string; text: string }[]; details: Record<string, unknown> }>;

/** Registers `registerTool` against a recording registry and returns its `execute`. */
function captureExecute(registerTool: (pi: { registerTool(tool: Record<string, unknown>): void }) => void): Execute {
  const registered: Record<string, unknown> = {};
  registerTool({ registerTool: (tool: Record<string, unknown>) => Object.assign(registered, tool) } as never);
  return registered["execute"] as Execute;
}

/** Extracts the text the model would see from a tool result. */
function resultText(result: Awaited<ReturnType<Execute>>): string {
  return result.content.map((c) => c.text).join("\n");
}

/** A parameterized case: build the fixture, run the tool, assert no literal fence survives. */
interface ToolCase {
  tool: string;
  /** Registers the tool and returns its captured `execute`. */
  capture: () => Execute;
  /** Creates the fixture directory the case runs in, and cleans up after itself via `t`. */
  fixture: (t: { after(fn: () => Promise<void> | void): void }) => Promise<string>;
  /** The tool-call arguments, resolved relative to the fixture `dir`. */
  args: (dir: string) => Record<string, unknown>;
}

const cases: ToolCase[] = [
  {
    tool: "read",
    capture: () => captureExecute(registerReadTool),
    fixture: async (t) => {
      const dir = await makeFixture({ "doc.md": FENCED_CONTENT });
      t.after(() => cleanupFixture(dir));
      return dir;
    },
    args: (dir) => ({ path: path.join(dir, "doc.md"), peek: false }),
  },
  {
    tool: "read (peek outline)",
    capture: () => captureExecute(registerReadTool),
    fixture: async (t) => {
      const dir = await makeFixture({ "doc.md": `# Heading\n${FENCED_CONTENT}` });
      t.after(() => cleanupFixture(dir));
      return dir;
    },
    args: (dir) => ({ path: path.join(dir, "doc.md") }),
  },
  {
    tool: "grep",
    capture: () => captureExecute(registerGrepTool),
    fixture: async (t) => {
      const dir = await makeFixture({ "doc.md": FENCED_CONTENT });
      t.after(() => cleanupFixture(dir));
      return dir;
    },
    args: () => ({ path: ".", regex: "const foo" }),
  },
  {
    tool: "find",
    capture: () => captureExecute(registerFindTool),
    fixture: async (t) => {
      const dir = await makeFixture({ [`${FENCE}file.txt`]: "" });
      t.after(() => cleanupFixture(dir));
      return dir;
    },
    args: () => ({ path: ".", pattern: "*.txt" }),
  },
  {
    tool: "list",
    capture: () => captureExecute(registerListTool),
    fixture: async (t) => {
      const dir = await makeFixture({ [`${FENCE}note.txt`]: "" });
      t.after(() => cleanupFixture(dir));
      return dir;
    },
    args: () => ({ path: "." }),
  },
  {
    tool: "lstat",
    capture: () => captureExecute(registerLstatTool),
    fixture: async (t) => {
      const dir = await makeFixture({ [`${FENCE}note.txt`]: "" });
      t.after(() => cleanupFixture(dir));
      return dir;
    },
    args: (dir) => ({ path: path.join(dir, `${FENCE}note.txt`) }),
  },
  {
    tool: "find_usages",
    capture: () => captureExecute(registerFindUsagesTool),
    fixture: async (t) => {
      const dir = await makeFixture({ "a.ts": `function foo() {}\n${FENCE}\nfoo();\n` });
      t.after(() => cleanupFixture(dir));
      return dir;
    },
    args: () => ({ path: ".", symbol: "foo", language: "typescript" }),
  },
  {
    tool: "git_status",
    capture: () => captureExecute(registerGitStatusTool),
    fixture: async (t) => {
      const dir = await makeFixture({});
      await initGitRepo(dir);
      await fs.writeFile(path.join(dir, `${FENCE}tracked.txt`), "x\n", "utf8");
      await fs.mkdir(path.join(dir, "sub"), { recursive: true });
      await fs.writeFile(path.join(dir, "sub", `${FENCE}untracked.txt`), "x\n", "utf8");
      t.after(() => cleanupFixture(dir));
      return dir;
    },
    args: () => ({}),
  },
  {
    tool: "git_log",
    capture: () => captureExecute(registerGitLogTool),
    fixture: async (t) => {
      const dir = await makeFixture({ "a.txt": "x\n" });
      await initGitRepo(dir);
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      await promisify(execFile)("git", [
        "commit",
        "-q",
        "--allow-empty",
        "-m",
        `docs: add ${FENCE} block`,
      ], { cwd: dir });
      t.after(() => cleanupFixture(dir));
      return dir;
    },
    args: () => ({}),
  },
  {
    tool: "git_diff",
    capture: () => captureExecute(registerGitDiffTool),
    fixture: async (t) => {
      const dir = await makeFixture({ "doc.md": "intro\n" });
      await initGitRepo(dir);
      await fs.writeFile(path.join(dir, "doc.md"), `intro\n${FENCED_CONTENT}`, "utf8");
      t.after(() => cleanupFixture(dir));
      return dir;
    },
    args: () => ({}),
  },
  {
    tool: "write",
    capture: () => captureExecute(registerWriteTool),
    fixture: async (t) => {
      const dir = await makeFixture({});
      t.after(() => cleanupFixture(dir));
      return dir;
    },
    args: (dir) => ({ path: path.join(dir, `${FENCE}out.txt`), content: "x\n" }),
  },
  {
    tool: "mkdir",
    capture: () => captureExecute(registerMkdirTool),
    fixture: async (t) => {
      const dir = await makeFixture({});
      t.after(() => cleanupFixture(dir));
      return dir;
    },
    args: (dir) => ({ path: path.join(dir, `${FENCE}dir`) }),
  },
  {
    tool: "copy",
    capture: () => captureExecute(registerCopyTool),
    fixture: async (t) => {
      const dir = await makeFixture({ [`${FENCE}src.txt`]: "x\n" });
      t.after(() => cleanupFixture(dir));
      return dir;
    },
    args: (dir) => ({ path: path.join(dir, `${FENCE}src.txt`), destination: path.join(dir, "dst.txt") }),
  },
  {
    tool: "move",
    capture: () => captureExecute(registerMoveTool),
    fixture: async (t) => {
      const dir = await makeFixture({ [`${FENCE}src.txt`]: "x\n" });
      t.after(() => cleanupFixture(dir));
      return dir;
    },
    args: (dir) => ({ path: path.join(dir, `${FENCE}src.txt`), destination: path.join(dir, "dst.txt") }),
  },
  {
    tool: "remove",
    capture: () => captureExecute(registerRemoveTool),
    fixture: async (t) => {
      const dir = await makeFixture({ [`${FENCE}gone.txt`]: "x\n" });
      t.after(() => cleanupFixture(dir));
      return dir;
    },
    args: (dir) => ({ path: path.join(dir, `${FENCE}gone.txt`) }),
  },
  {
    tool: "insert",
    capture: () => captureExecute(registerInsertTool),
    fixture: async (t) => {
      const dir = await makeFixture({ [`${FENCE}a.txt`]: "one\n" });
      t.after(() => cleanupFixture(dir));
      return dir;
    },
    args: (dir) => ({ path: path.join(dir, `${FENCE}a.txt`), line: 1, text: "two\n" }),
  },
  {
    tool: "edit",
    capture: () => captureExecute(registerEditTool),
    fixture: async (t) => {
      const dir = await makeFixture({ [`${FENCE}a.txt`]: "const foo = 1;\n" });
      t.after(() => cleanupFixture(dir));
      return dir;
    },
    args: (dir) => ({ path: path.join(dir, `${FENCE}a.txt`), oldText: "foo", newText: "bar" }),
  },
];

for (const { tool, capture, fixture, args } of cases) {
  test(`"${tool}" result escapes triple backticks`, async (t) => {
    const dir = await fixture(t);
    const execute = capture();
    const result = await execute("t1", args(dir), undefined, undefined, { cwd: dir });
    const text = resultText(result);
    assert.ok(
      !text.includes(FENCE),
      `${tool} returned literal triple backticks; expected them escaped:\n${text}`
    );
  });
}

test("escapeTripleBackticks splits every backtick run of three or more, leaves the rest alone", () => {
  assert.equal(escapeTripleBackticks("plain text"), "plain text");
  assert.equal(escapeTripleBackticks("one ` two `"), "one ` two `");
  assert.equal(escapeTripleBackticks("``"), "``");
  const escaped = escapeTripleBackticks(`${FENCE}js\ncode\n${FENCE}`);
  assert.ok(!escaped.includes(FENCE));
  assert.ok(escaped.includes("`"));
  assert.ok(escaped.includes("\u200B"));
  const longRun = escapeTripleBackticks("`````");
  assert.ok(!longRun.includes("```"));
  assert.equal(longRun.replace(/\u200B/g, "").length, 5);
});
