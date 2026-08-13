import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { withFileMutationQueue } from "../mutationQueue.ts";
import { makeFixture, cleanupFixture } from "./fixtures.ts";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("serializes operations targeting the same path", async (t) => {
  const dir = await makeFixture({ "a.txt": "" });
  t.after(() => cleanupFixture(dir));
  const file = path.join(dir, "a.txt");

  const events: string[] = [];
  const op = (label: string, ms: number) =>
    withFileMutationQueue(file, async () => {
      events.push(`${label}-start`);
      await delay(ms);
      events.push(`${label}-end`);
    });

  // A is registered first (called first, synchronously, before B) and has the longer delay; if
  // queued correctly B can't start until A's whole operation — including its delay — has
  // finished, regardless of B's own delay being shorter.
  await Promise.all([op("A", 30), op("B", 10)]);

  assert.deepEqual(events, ["A-start", "A-end", "B-start", "B-end"]);
});

test("does not serialize operations targeting different paths", async (t) => {
  const dir = await makeFixture({ "a.txt": "", "b.txt": "" });
  t.after(() => cleanupFixture(dir));
  const fileA = path.join(dir, "a.txt");
  const fileB = path.join(dir, "b.txt");

  const events: string[] = [];
  const op = (file: string, label: string, ms: number) =>
    withFileMutationQueue(file, async () => {
      events.push(`${label}-start`);
      await delay(ms);
      events.push(`${label}-end`);
    });

  // If these were serialized like the same-path case, B (shorter delay) would still have to
  // wait for A to finish. Since they target different files, B starts immediately and finishes
  // before A despite starting second.
  await Promise.all([op(fileA, "A", 30), op(fileB, "B", 10)]);

  assert.deepEqual(events, ["A-start", "B-start", "B-end", "A-end"]);
});

test("an operation that throws still releases the queue for the next one", async (t) => {
  const dir = await makeFixture({ "a.txt": "" });
  t.after(() => cleanupFixture(dir));
  const file = path.join(dir, "a.txt");

  await assert.rejects(() =>
    withFileMutationQueue(file, async () => {
      throw new Error("boom");
    })
  );

  // Would hang forever if the failed operation above left this path's queue permanently locked.
  const result = await withFileMutationQueue(file, async () => "ok");
  assert.equal(result, "ok");
});

test("keys two different spellings of the same real path together", async (t) => {
  const dir = await makeFixture({ "sub/a.txt": "" });
  t.after(() => cleanupFixture(dir));
  const direct = path.join(dir, "sub", "a.txt");
  const roundabout = path.join(dir, "sub", "..", "sub", "a.txt");

  const events: string[] = [];
  const op = (file: string, label: string, ms: number) =>
    withFileMutationQueue(file, async () => {
      events.push(`${label}-start`);
      await delay(ms);
      events.push(`${label}-end`);
    });

  await Promise.all([op(direct, "A", 30), op(roundabout, "B", 10)]);

  assert.deepEqual(events, ["A-start", "A-end", "B-start", "B-end"]);
});
