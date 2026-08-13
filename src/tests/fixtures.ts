import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

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
