// Plain JavaScript ESM worker - no TypeScript compilation needed
import { parentPort, workerData } from "node:worker_threads";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import micromatch from "micromatch";

/**
 * Simple sandbox check for the worker - mirrors the core logic from sandbox.ts
 * but without TypeScript dependencies.
 */
function isEntrySandboxSafe(base, entryPath, mode, isSymlink, sandboxState) {
  // When sandbox is off, allow everything
  if (sandboxState === "off") return true;
  
  // Block symlinks that might escape the base
  if (isSymlink) return false;
  
  // Block restricted globs (simplified version)
  const restricted = [
    "**/.env*", "**/.aws/**", "**/.ssh/**", "**/.netrc", "**/.npmrc",
    "**/.pgpass", "**/.docker/**", "**/.kube/**", "**/.gnupg/**",
    "**/.git/**", "**/id_rsa*", "**/id_ed25519*", "**/.gcloud/**"
  ];
  
  for (const pattern of restricted) {
    if (micromatch.isMatch(entryPath, pattern)) return false;
  }
  
  return true;
}

async function run() {
  const { base, files, pattern, flags, max, context, sandboxState } = workerData;
  const regex = new RegExp(pattern, flags);

  const lines = [];
  let matchCount = 0;
  let filesScanned = 0;
  let truncated = false;

  outer: for (const file of files) {
    if (!isEntrySandboxSafe(base, file.path, "read", file.isSymlink, sandboxState)) continue;

    let content;
    try {
      content = await fs.readFile(path.join(base, file.path), "utf8");
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
        lines.push({ file: file.path, line: j + 1, text: fileLines[j] || "", isMatch: j === i });
      }
    }
  }

  parentPort.postMessage({ lines, matchCount, filesScanned, truncated });
}

run().catch((err) => {
  parentPort.postMessage({ error: err.message });
});