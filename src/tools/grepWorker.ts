import { parentPort, workerData } from "node:worker_threads";
import * as fs from "node:fs/promises";
import * as path from "node:path";

interface GrepLine {
  file: string;
  line: number;
  text: string;
  isMatch: boolean;
}

interface GrepWorkerInput {
  base: string;
  files: string[];
  pattern: string;
  flags: string;
  max: number;
  context: number;
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
  const { base, files, pattern, flags, max, context } = workerData as GrepWorkerInput;
  const regex = new RegExp(pattern, flags);

  const lines: GrepLine[] = [];
  let matchCount = 0;
  let filesScanned = 0;
  let truncated = false;

  outer: for (const relFile of files) {
    let content: string;
    try {
      content = await fs.readFile(path.join(base, relFile), "utf8");
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
        lines.push({ file: relFile, line: j + 1, text: fileLines[j] ?? "", isMatch: j === i });
      }
    }
  }

  const output: GrepWorkerOutput = { lines, matchCount, filesScanned, truncated };
  parentPort!.postMessage(output);
}

run().catch((err) => {
  parentPort!.postMessage({ error: (err as Error).message });
});
