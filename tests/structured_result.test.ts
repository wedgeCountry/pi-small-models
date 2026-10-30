import { test } from "node:test";
import assert from "node:assert/strict";
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
import { isToolFormattedError } from "../src/backend/formatError.ts";

/**
 * Every tool must answer with Pi's structured tool-result shape:
 *
 *   { role: "toolResult", toolName, content: [{ type: "text", text }], isError }
 *
 * The framework builds that message from what `execute()` returns — `{ content, details }` on
 * success, the thrown (tool-formatted) error converted to `isError: true` on failure. So each
 * tool is held to two contracts here: the result it returns is the structured shape (a `content`
 * array of `{ type: "text" }` blocks with string `text`, plus an object `details`), and a
 * failing call throws a tool-formatted `Error` rather than returning a bare string or rejecting
 * with a non-error value — the shape Pi needs to produce the structured `role: "toolResult"`
 * message in both cases.
 */

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

/** A directory the tool operates in, cleaned up after the test. */
type FixtureFactory = (t: { after(fn: () => Promise<void> | void): void }) => Promise<string>;

/** A parameterized case: the tool's registered `execute` plus a succeeding call against a fixture. */
interface ToolCase {
  tool: string;
  capture: () => Execute;
  fixture: FixtureFactory;
  args: (dir: string) => Record<string, unknown>;
  /** Arguments for a call that must fail; defaults to a nonexistent absolute path. */
  failingArgs?: (dir: string) => Record<string, unknown>;
  /** Fixture for the failure call; defaults to an empty directory. */
  failingFixture?: FixtureFactory;
}

const plainFixture: FixtureFactory = async (t) => {
  const dir = await makeFixture({ "a.txt": "const foo = 1;\n", "sub/b.md": "# b\n" });
  t.after(() => cleanupFixture(dir));
  return dir;
};

const gitFixture: FixtureFactory = async (t) => {
  const dir = await makeFixture({ "a.txt": "const foo = 1;\n" });
  await initGitRepo(dir);
  t.after(() => cleanupFixture(dir));
  return dir;
};

const cases: ToolCase[] = [
  {
    tool: "read",
    capture: () => captureExecute(registerReadTool),
    fixture: plainFixture,
    args: (dir) => ({ path: path.join(dir, "a.txt"), peek: false }),
  },
  {
    tool: "grep",
    capture: () => captureExecute(registerGrepTool),
    fixture: plainFixture,
    args: () => ({ path: ".", regex: "foo" }),
    failingArgs: () => ({ path: ".", regex: "[" }),
  },
  {
    tool: "find",
    capture: () => captureExecute(registerFindTool),
    fixture: plainFixture,
    args: () => ({ path: ".", pattern: "*.txt" }),
    failingArgs: () => ({ path: ".", pattern: "/absolute/pattern" }),
  },
  {
    tool: "find_usages",
    capture: () => captureExecute(registerFindUsagesTool),
    fixture: plainFixture,
    args: () => ({ path: ".", symbol: "foo", language: "typescript" }),
  },
  {
    tool: "list",
    capture: () => captureExecute(registerListTool),
    fixture: plainFixture,
    args: () => ({ path: "." }),
  },
  {
    tool: "lstat",
    capture: () => captureExecute(registerLstatTool),
    fixture: plainFixture,
    args: (dir) => ({ path: path.join(dir, "a.txt") }),
  },
  {
    tool: "git_status",
    capture: () => captureExecute(registerGitStatusTool),
    fixture: gitFixture,
    args: () => ({}),
  },
  {
    tool: "git_log",
    capture: () => captureExecute(registerGitLogTool),
    fixture: gitFixture,
    args: () => ({}),
  },
  {
    tool: "git_diff",
    capture: () => captureExecute(registerGitDiffTool),
    fixture: gitFixture,
    args: () => ({}),
  },
  {
    tool: "write",
    capture: () => captureExecute(registerWriteTool),
    fixture: plainFixture,
    args: (dir) => ({ path: path.join(dir, "out.txt"), content: "x\n" }),
  },
  {
    tool: "mkdir",
    capture: () => captureExecute(registerMkdirTool),
    fixture: plainFixture,
    args: (dir) => ({ path: path.join(dir, "newdir") }),
    failingArgs: (dir) => ({ path: path.join(dir, "a.txt", "child") }),
    failingFixture: plainFixture,
  },
  {
    tool: "copy",
    capture: () => captureExecute(registerCopyTool),
    fixture: plainFixture,
    args: (dir) => ({ path: path.join(dir, "a.txt"), destination: path.join(dir, "a-copy.txt") }),
    failingArgs: (dir) => ({ path: path.join(dir, "does-not-exist"), destination: path.join(dir, "dst.txt") }),
  },
  {
    tool: "move",
    capture: () => captureExecute(registerMoveTool),
    fixture: plainFixture,
    args: (dir) => ({ path: path.join(dir, "a.txt"), destination: path.join(dir, "a-moved.txt") }),
    failingArgs: (dir) => ({ path: path.join(dir, "does-not-exist"), destination: path.join(dir, "dst.txt") }),
  },
  {
    tool: "remove",
    capture: () => captureExecute(registerRemoveTool),
    fixture: plainFixture,
    args: (dir) => ({ path: path.join(dir, "a.txt") }),
  },
  {
    tool: "insert",
    capture: () => captureExecute(registerInsertTool),
    fixture: plainFixture,
    args: (dir) => ({ path: path.join(dir, "sub/b.md"), line: 1, text: "inserted\n" }),
  },
  {
    tool: "edit",
    capture: () => captureExecute(registerEditTool),
    fixture: plainFixture,
    args: (dir) => ({ path: path.join(dir, "a.txt"), oldText: "foo", newText: "bar" }),
  },
];

for (const { tool, capture, fixture, args, failingArgs, failingFixture } of cases) {
  test(`"${tool}" returns a structured result (content array of text blocks plus details)`, async (t) => {
    const dir = await fixture(t);
    const result = await capture()("t1", args(dir), undefined, undefined, { cwd: dir });

    assert.ok(result !== null && typeof result === "object" && !Array.isArray(result), `${tool} returned a non-object`);
    assert.ok(Array.isArray(result.content), `${tool} result has no content array`);
    assert.ok(result.content.length > 0, `${tool} returned an empty content array`);
    for (const [i, block] of result.content.entries()) {
      assert.equal(block.type, "text", `${tool} content[${i}] is not a text block`);
      assert.equal(typeof block.text, "string", `${tool} content[${i}].text is not a string`);
    }
    assert.ok(
      result.details !== null && typeof result.details === "object" && !Array.isArray(result.details),
      `${tool} result has no details object`
    );
  });

  test(`"${tool}" failure is a thrown tool-formatted error (the isError: true shape), never a bare value`, async (t) => {
    const failArgs = failingArgs
      ? failingArgs
      : (dir: string) => ({ path: path.join(dir, "does-not-exist") });
    const failFixture = failingFixture ?? (async (t) => {
      const dir = await makeFixture({});
      t.after(() => cleanupFixture(dir));
      return dir;
    });
    const dir = await failFixture(t);
    t.after(() => cleanupFixture(dir));

    await assert.rejects(
      () => capture()("t2", failArgs(dir), undefined, undefined, { cwd: dir }),
      (err: unknown) => {
        assert.ok(err instanceof Error, `${tool} rejected with a non-Error value: ${String(err)}`);
        assert.equal(typeof (err as Error).message, "string", `${tool}'s error has no string message`);
        assert.ok(isToolFormattedError(err), `${tool}'s error is not tool-formatted: ${(err as Error).message}`);
        return true;
      }
    );
  });
}
