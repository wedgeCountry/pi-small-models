import { parentPort, workerData } from "node:worker_threads";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { isEntrySandboxSafe, type SandboxState } from "../sandbox.ts";

interface GrepLine {
  file: string;
  line: number;
  text: string;
  isMatch: boolean;
}

interface GrepWorkerFile {
  path: string;
  isSymlink: boolean;
}

interface GrepWorkerInput {
  base: string;
  files: GrepWorkerFile[];
  pattern: string;
  flags: string;
  max: number;
  context: number;
  sandboxState: SandboxState;
}

interface GrepWorkerOutput {
  lines: GrepLine[];
  matchCount: number;
  filesScanned: number;
  truncated: boolean;
}

// Runs the actual file-content scan on a disposable worker thread so the main
// thread can enforce a hard timeout: a pathological regex (catastrophic
// backtracking) can only hang this worker, which the caller then terminates,
// rather than freezing the whole extension process.
async function run(): Promise<void> {
  const { base, files, pattern, flags, max, context, sandboxState } = workerData as GrepWorkerInput;
  const regex = new RegExp(pattern, flags);

  const lines: GrepLine[] = [];
  let matchCount = 0;
  let filesScanned = 0;
  let truncated = false;

  outer: for (const file of files) {
    // Re-verify independently of the main thread's own pre-filter (see the comment on
    // `scanInWorker` in grep.ts for why) — `sandboxState` is passed in explicitly since this
    // worker's own import of sandbox.ts has its own separate module state, not the main thread's.
    if (!isEntrySandboxSafe(base, file.path, "read", file.isSymlink, sandboxState)) continue;

    let content: string;
    try {
      content = await fs.readFile(path.join(base, file.path), "utf8");
    } catch {
      continue; // unreadable or not text
    }
    if (content.includes("\0")) continue; // skip binary files

    filesScanned++;
    const fileLines = content.split("\n");
    for (let i = 0; i < fileLines.length; i++) {
      if (!regex.test(fileLines[i] ?? "")) continue;
      if (matchCount >= max) {
        truncated = true;
        break outer;
      }
      matchCount++;
      const from = Math.max(0, i - context);
      const to = Math.min(fileLines.length - 1, i + context);
      for (let j = from; j <= to; j++) {
        lines.push({ file: file.path, line: j + 1, text: fileLines[j] ?? "", isMatch: j === i });
      }
    }
  }

  const output: GrepWorkerOutput = { lines, matchCount, filesScanned, truncated };
  parentPort!.postMessage(output);
}

run().catch((err) => {
  parentPort!.postMessage({ error: (err as Error).message });
});
