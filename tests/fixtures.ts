import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

/** Creates a temp directory populated with `files` (relative path -> content). */
export async function makeFixture(files: Record<string, string>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-tools-test-"));
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = path.join(dir, relPath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, "utf8");
  }
  return dir;
}

export async function cleanupFixture(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

/**
 * Turns `dir` (already populated via `makeFixture`) into a git repository with a single commit of
 * its current contents, so `git_status.test.ts`/`git_diff.test.ts` have a clean baseline to make
 * further changes against. `--allow-empty` covers `makeFixture({})`, which would otherwise leave
 * nothing staged for the commit to record. `user.email`/`user.name` are set locally (not read from
 * global git config) so this works in a fresh CI checkout with no git identity configured.
 */
export async function initGitRepo(dir: string): Promise<void> {
  await execFile("git", ["init", "-q"], { cwd: dir });
  await execFile("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  await execFile("git", ["config", "user.name", "Test"], { cwd: dir });
  await execFile("git", ["add", "-A"], { cwd: dir });
  await execFile("git", ["commit", "-q", "-m", "initial", "--allow-empty"], { cwd: dir });
}
