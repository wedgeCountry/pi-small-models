// Plain JavaScript ESM worker - no TypeScript compilation needed
import { parentPort, workerData } from "node:worker_threads";
import * as fs from "node:fs/promises";
import * as path from "node:path";

async function run() {
  // `files` were approved by the sandbox on the main thread (see grepFiles); no rules live here.
  const { base, files, pattern, flags, max, context } = workerData;
  const regex = new RegExp(pattern, flags);

  const lines = [];
  let matchCount = 0;
  let filesScanned = 0;
  let truncated = false;

  outer: for (const file of files) {
    let content;
    try {
      content = await fs.readFile(path.join(base, file), "utf8");
    } catch {
      continue;
    }
    if (content.includes("\0")) continue;

    filesScanned++;
    const fileLines = content.split("\n");
    for (let i = 0; i < fileLines.length; i++) {
      if (!regex.test(fileLines[i] || "")) continue;
      if (matchCount >= max) {
        truncated = true;
        break outer;
      }
      matchCount++;
      const from = Math.max(0, i - context);
      const to = Math.min(fileLines.length - 1, i + context);
      for (let j = from; j <= to; j++) {
        lines.push({ file, line: j + 1, text: fileLines[j] || "", isMatch: j === i });
      }
    }
  }

  parentPort.postMessage({ lines, matchCount, filesScanned, truncated });
}

run().catch((err) => {
  parentPort.postMessage({ error: err.message });
});