import * as fs from "node:fs/promises";
import * as path from "node:path";
import { withFileMutationQueue } from "../backend/mutationQueue.ts";

/** Requirements files pip projects commonly use, best-match first. */
const REQUIREMENTS_FILES = ["requirements.txt", "requirements.in", "dev-requirements.txt"];

/** Finds the first existing requirements file in `root`, or undefined. */
export async function findRequirementsFile(root: string): Promise<string | undefined> {
  for (const name of REQUIREMENTS_FILES) {
    const p = path.join(root, name);
    try {
      if ((await fs.stat(p)).isFile()) return p;
    } catch {
      // not present — try the next candidate
    }
  }
  return undefined;
}

/** True when the requirements line pins `name` (name, name==ver, name>=ver, name[extras], ...). */
function lineIsForPackage(line: string, name: string): boolean {
  const normalized = name.toLowerCase().replace(/[-_.]+/g, "-");
  const match = line.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(\[.*?\])?\s*[=<>~!;]/);
  const lineName = match?.[1]?.toLowerCase().replace(/[-_.]+/g, "-");
  return lineName === normalized || line.trim().toLowerCase() === normalized;
}

/**
 * Adds `name==version` (or `name` without a version) to the requirements file,
 * replacing an existing pin for the same package. Creates `requirements.txt`
 * when no requirements file exists. Returns a short description of the change.
 */
export async function addRequirement(root: string, name: string, version?: string): Promise<string> {
  const file = (await findRequirementsFile(root)) ?? path.join(root, "requirements.txt");
  return withFileMutationQueue(file, async () => {
    const spec = version ? `${name}==${version}` : name;
    let lines: string[] = [];
    let existed = false;
    try {
      lines = (await fs.readFile(file, "utf8")).split(/\r?\n/);
    } catch {
      lines = [];
    }
    const out: string[] = [];
    for (const line of lines) {
      if (lineIsForPackage(line, name)) {
        existed = true;
        out.push(spec);
      } else {
        out.push(line);
      }
    }
    if (!existed) {
      while (out.length > 0 && out[out.length - 1] === "") out.pop();
      out.push(spec);
    }
    // exactly one trailing newline
    const content = out.filter((l, i) => !(l === "" && i === out.length - 1)).join("\n").replace(/\n*$/, "\n");
    if (!content.trim()) {
      await fs.writeFile(file, `${spec}\n`, "utf8");
    } else {
      await fs.writeFile(file, content.endsWith("\n") ? content : `${content}\n`, "utf8");
    }
    return existed
      ? `Updated ${path.basename(file)}: ${spec}`
      : `Added ${spec} to ${path.basename(file)}`;
  });
}

/**
 * Removes every line pinning `name` from the requirements file, when one
 * exists. Returns a short description, or undefined when there was nothing
 * to remove (no requirements file, or the package was not pinned in it).
 */
export async function removeRequirement(root: string, name: string): Promise<string | undefined> {
  const file = await findRequirementsFile(root);
  if (!file) return undefined;
  return withFileMutationQueue(file, async () => {
    let content: string;
    try {
      content = await fs.readFile(file, "utf8");
    } catch {
      return undefined;
    }
    const lines = content.split(/\r?\n/);
    const out = lines.filter((line) => !(lineIsForPackage(line, name) && !line.trim().startsWith("#")));
    if (out.length === lines.length) return undefined;
    await fs.writeFile(file, out.join("\n"), "utf8");
    return `Removed ${name} from ${path.basename(file)}`;
  });
}
