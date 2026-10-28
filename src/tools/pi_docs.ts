import * as fs from "node:fs/promises";
import type { Stats } from "node:fs";
import * as path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { PI_DOCS_TOOL_DEFINITION } from "../tool_definitions/pi_docs.ts";
import {
  discoverPiDocs,
  isPiDocPath,
  PI_DOC_ENTRIES,
  PI_PACKAGE_NAME,
  readOnlySandbox,
  type PiDocsLocation,
} from "../sandbox/piRoots.ts";
import type { ToolRegistry } from "../sandbox/permissionGate.ts";
import type { Sandbox } from "../sandbox/sandbox.ts";
import { callName, oneLine } from "../backend/renderCall.ts";
import { withConciseValidationErrors } from "../backend/toolValidation.ts";
import { toolError } from "../backend/formatError.ts";
import { readFile, type ReadResult } from "./read.ts";
import type { ListEntry } from "./list.ts";

const DEFAULT_MAX_RESULTS = 200;
const DEFAULT_MAX_DEPTH = 4;

export interface PiDocsOptions {
  offset?: number;
  limit?: number;
  signal?: AbortSignal;
  maxResults?: number;
  maxDepth?: number;
}

export type PiDocsResult =
  | { kind: "file"; path: string; content: ReadResult }
  | { kind: "listing"; path: string; entries: ListEntry[]; truncated: boolean };

/**
 * Normalise `params.path` into a path relative to Pi's package root ("" means the root itself):
 * backslashes unified to `/`, a leading `./` dropped, a trailing `/` and a bare `.` removed.
 * Deliberately *not* normalising away `..` segments — those must reach `Sandbox.resolve` (and the
 * `PI_DOC_ENTRIES` check below) in the shape the model asked for, so they get rejected rather than
 * quietly rewritten into a valid path.
 */
export function piDocsTarget(target: string | undefined): string {
  let rel = (target ?? "").trim().replace(/\\/g, "/");
  while (rel.startsWith("./")) rel = rel.slice(2);
  if (rel === ".") rel = "";
  return rel.replace(/\/+$/, "");
}

/**
 * Read one of Pi's own documentation files, or list what is available, from the installed package copy
 * described by `location`.
 *
 * The package root is turned into a `readOnlySandbox()` (`src/sandbox/piRoots.ts`), so containment,
 * symlink resolution and `policy.ts` apply relative to that root exactly as they do for a project. On
 * top of that the first path segment must be one of `PI_DOC_ENTRIES`, which is what keeps the rest of
 * the package — its `src/`, `package.json`, own `node_modules/` — unreachable even through a
 * `examples/../src/...` path that never leaves the root.
 *
 * An empty `target` walks only the allowlisted entries (`README.md`, `docs/`, `examples/`, …) rather
 * than the package root, so a listing never wanders into the package's source tree.
 */
export async function readPiDocs(
  location: PiDocsLocation,
  target: string | undefined,
  opts: PiDocsOptions = {}
): Promise<PiDocsResult> {
  const rel = piDocsTarget(target);
  if (rel !== "") assertInDocScope(rel, target);

  const sb = readOnlySandbox(location.packageRoot);
  const maxResults = opts.maxResults ?? DEFAULT_MAX_RESULTS;

  if (rel === "") {
    const entries: ListEntry[] = [];
    let truncated = false;
    for (const entry of location.entries) {
      if (entries.length >= maxResults) {
        truncated = true;
        break;
      }
      if (await isPlainDirectory(path.join(location.packageRoot, entry))) {
        const below = await listDocsDirectory(sb, entry, maxResults - entries.length, opts);
        entries.push({ path: entry, isDirectory: true });
        for (const sub of below.entries) entries.push({ path: `${entry}/${sub.path}`, isDirectory: sub.isDirectory });
        truncated ||= below.truncated;
      } else {
        entries.push({ path: entry, isDirectory: false });
      }
    }
    return { kind: "listing", path: "", entries, truncated };
  }

  // `Sandbox.resolve` first: the path must stay inside the package root, on paper and after following
  // symlinks, and no protected `policy.ts` segment may appear in it.
  const absolute = sb.resolve(rel);
  assertInDocScope(relativeInside(location.packageRoot, absolute), target);

  const stat = await statExisting(absolute, rel, location.version);

  // Then the same allowlist check against the symlink-resolved location, so a `docs` that is a symlink
  // to `src` — inside the same package root, and so passing the containment check above — is still out
  // of scope: the allowlist has to hold for where the path really is, not only for how it was spelled.
  assertInDocScope(
    relativeInside(await realpathOrSelf(location.packageRoot), await realpathOrSelf(absolute)),
    target
  );

  if (stat.isDirectory()) {
    const listing = await listDocsDirectory(sb, rel, maxResults, opts);
    return { kind: "listing", path: rel, entries: listing.entries, truncated: listing.truncated };
  }

  return { kind: "file", path: rel, content: await readFile(sb, rel, { offset: opts.offset, limit: opts.limit, signal: opts.signal }) };
}

/**
 * `PI_DOC_ENTRIES` gate, applied to a path relative to the package root. Checking the *resolved* path
 * as well as the requested one is what stops `docs/../src/core/x.ts`: that stays inside the root, so
 * containment alone would let it through.
 */
function assertInDocScope(rel: string, target: string | undefined): void {
  if (isPiDocPath(rel)) return;
  throw toolError(
    "pi_docs",
    `"${target ?? rel}" is not part of Pi's documentation. pi_docs reaches ${PI_DOC_ENTRIES.join(", ")} inside ` +
      `${PI_PACKAGE_NAME} only.`,
    { path: target ?? rel }
  );
}

/**
 * `readFile`'s capped, line-numbered result shape applied to a Pi docs file, so `pi_docs` output and
 * `read` output look the same to the model.
 */
function renderDocsFile(result: ReadResult): string {
  let text = result.lines.map((l) => `${l.line}:${l.text}`).join("\n");
  if (result.truncated) {
    const lastLine = result.lines[result.lines.length - 1]?.line ?? 0;
    text += `\n\n[Showing lines ${result.lines[0]?.line ?? 1}-${lastLine} of ${result.totalLines}. Use offset=${lastLine + 1} to continue.]`;
  }
  return text;
}

function renderDocsListing(location: PiDocsLocation, result: Extract<PiDocsResult, { kind: "listing" }>): string {
  const scope = result.path === "" ? "" : ` in ${result.path}`;
  const header = `Pi ${location.version} documentation${scope} (${location.packageRoot}):`;
  if (result.entries.length === 0) return `${header}\n(no files here)`;
  const lines = result.entries.map((e) => (e.isDirectory ? `${e.path}/` : e.path));
  if (result.truncated) lines.push("… listing truncated; ask for a narrower path (for example \"docs\") to see the rest");
  return `${header}\n${lines.join("\n")}`;
}

async function listDocsDirectory(
  sb: Sandbox,
  target: string,
  maxResults: number,
  opts: PiDocsOptions
): Promise<{ entries: ListEntry[]; truncated: boolean }> {
  const base = sb.resolve(target);
  const allowed = sb.entryFilter(base);
  const maxDepth = Math.max(1, Math.min(opts.maxDepth ?? DEFAULT_MAX_DEPTH, 8));
  const entries: ListEntry[] = [];
  let truncated = false;

  async function walk(dir: string, relPrefix: string, depth: number): Promise<void> {
    if (opts.signal?.aborted) throw new Error("Aborted");
    const dirents = await fs.readdir(dir, { withFileTypes: true });
    const sorted = dirents
      .filter((d) => !d.name.startsWith("."))
      .sort((a, b) => a.name.localeCompare(b.name, "en"));

    for (const dirent of sorted) {
      if (entries.length >= maxResults) {
        truncated = true;
        return;
      }
      const relPath = relPrefix ? `${relPrefix}/${dirent.name}` : dirent.name;
      // Same rule as `list`: don't even disclose the name of anything the sandbox rejects.
      if (!allowed(relPath, dirent.isSymbolicLink())) continue;
      const isDirectory = dirent.isDirectory();
      entries.push({ path: relPath, isDirectory });
      if (isDirectory && depth < maxDepth) await walk(path.join(dir, dirent.name), relPath, depth + 1);
    }
  }

  await walk(base, "", 0);
  return { entries, truncated };
}

/**
 * True only for a real directory — a symlink is deliberately not one, so the root listing can't be
 * talked into walking the package's source tree through a `docs -> src` symlink.
 */
async function isPlainDirectory(target: string): Promise<boolean> {
  try {
    return (await fs.lstat(target)).isDirectory();
  } catch {
    return false;
  }
}

/** `target` as a POSIX path relative to `root` (`..` segments stay visible instead of being hidden). */
function relativeInside(root: string, target: string): string {
  return path.relative(root, target).split(path.sep).join("/");
}

async function realpathOrSelf(target: string): Promise<string> {
  try {
    return await fs.realpath(target);
  } catch {
    return target;
  }
}

/** `fs.stat` with a model-friendly miss: the path is reported relative to the package root, never as a host path. */
async function statExisting(absolute: string, rel: string, version: string): Promise<Stats> {
  try {
    return await fs.stat(absolute);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw toolError(
        "pi_docs",
        `"${rel}" does not exist in Pi ${version}'s documentation. Call pi_docs with no path to list what is available.`,
        { path: rel }
      );
    }
    throw err;
  }
}

/**
 * Registered directly on `pi` rather than through the gated registry: these calls read only Pi's own
 * installed files, are always containment-checked against a root the model cannot choose, and asking
 * the user to approve every docs lookup would make the `/toggle-sandbox off` fallback useless for
 * the very question ("how does pi work?") that tool exists to answer.
 */
export function registerPiDocsTool(pi: ToolRegistry) {
  pi.registerTool({
    ...PI_DOCS_TOOL_DEFINITION,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    prepareArguments: withConciseValidationErrors(PI_DOCS_TOOL_DEFINITION.name, PI_DOCS_TOOL_DEFINITION.parameters),
    renderCall(args, theme) {
      const target = piDocsTarget(args.path);
      return oneLine(`${callName(theme, "pi_docs")} ${theme.fg("accent", target === "" ? "(list)" : target)}`);
    },
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const locations = await discoverPiDocs({ agentDir: getAgentDir(), cwd: ctx.cwd });
      if (locations.length === 0) {
        throw toolError(
          "pi_docs",
          `Could not find Pi's own documentation: no installed copy of ${PI_PACKAGE_NAME} with a ` +
            `${PI_DOC_ENTRIES.join(", ")} entry was found.`
        );
      }

      const location = locations[0]!;
      const result = await readPiDocs(location, params.path, {
        offset: params.offset,
        limit: params.limit,
        signal,
      });

      if (result.kind === "file") {
        return {
          content: [{ type: "text", text: renderDocsFile(result.content) }],
          details: {
            version: location.version,
            kind: result.kind,
            path: result.path,
            totalLines: result.content.totalLines,
            truncated: result.content.truncated,
          },
        };
      }

      return {
        content: [{ type: "text", text: renderDocsListing(location, result) }],
        details: { version: location.version, kind: result.kind, path: result.path, entries: result.entries.length, truncated: result.truncated },
      };
    },
  });
}
