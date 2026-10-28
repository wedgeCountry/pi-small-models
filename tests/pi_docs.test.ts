import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { discoverPiDocs, PI_PACKAGE_NAME, type PiResourceRoots } from "../src/sandbox/piRoots.ts";
import { piDocsTarget, readPiDocs, type PiDocsResult } from "../src/tools/pi_docs.ts";
import { SandboxError } from "../src/sandbox/sandbox.ts";
import { makeFixture, cleanupFixture } from "./fixtures.ts";

const PKG_REL = path.join(
  "agent",
  "install",
  "releases",
  "1.4.0",
  "node_modules",
  "@earendil-works",
  "pi-coding-agent"
);

const PKG_FILES: Record<string, string> = {
  [`${PKG_REL}/package.json`]: JSON.stringify({ name: PI_PACKAGE_NAME, version: "1.4.0" }),
  [`${PKG_REL}/README.md`]: "# Pi\npi readme",
  [`${PKG_REL}/CHANGELOG.md`]: "# Changelog\nchanges",
  [`${PKG_REL}/docs/extensions.md`]: "# Extensions\nextension api",
  [`${PKG_REL}/docs/tools.md`]: "# Tools\ntool api",
  [`${PKG_REL}/examples/extensions/hello.ts`]: "export default function () {}",
  // Everything below is inside the package root but out of `pi_docs`' scope.
  [`${PKG_REL}/src/core/internal.ts`]: "internal source",
  [`${PKG_REL}/dist/built.js`]: "built source",
};

async function docsFixture(extraFiles: Record<string, string> = {}) {
  const dir = await makeFixture({
    ...PKG_FILES,
    ...extraFiles,
    "outside/secret.txt": "outside secret",
    "project/src/index.ts": "console.log(1)",
  });
  return {
    dir,
    packageRoot: path.join(dir, PKG_REL),
    roots: {
      agentDir: path.join(dir, "agent"),
      cwd: path.join(dir, "project"),
      homeDir: path.join(dir, "home"),
    } satisfies PiResourceRoots,
  };
}

async function docsLocation(roots: PiResourceRoots) {
  const locations = await discoverPiDocs(roots);
  assert.ok(locations.length > 0, "expected to find a pi package copy");
  return locations[0]!;
}

function asFile(result: PiDocsResult) {
  assert.equal(result.kind, "file");
  return (result as Extract<PiDocsResult, { kind: "file" }>).content;
}

function asListing(result: PiDocsResult) {
  assert.equal(result.kind, "listing");
  return result as Extract<PiDocsResult, { kind: "listing" }>;
}

async function trySymlink(t: { skip(msg: string): void }, target: string, link: string): Promise<boolean> {
  try {
    await fs.symlink(target, link, "file");
    return true;
  } catch (err) {
    t.skip(`cannot create symlinks here: ${(err as Error).message}`);
    return false;
  }
}

// --- argument shaping ------------------------------------------------------------------------

test("piDocsTarget normalises to a path relative to the package root, leaving .. visible", () => {
  assert.equal(piDocsTarget(undefined), "");
  assert.equal(piDocsTarget(""), "");
  assert.equal(piDocsTarget("."), "");
  assert.equal(piDocsTarget("./"), "");
  assert.equal(piDocsTarget("./docs/"), "docs");
  assert.equal(piDocsTarget("  docs/extensions.md  "), "docs/extensions.md");
  assert.equal(piDocsTarget("docs\\extensions.md"), "docs/extensions.md");
  assert.equal(piDocsTarget("docs/../src/core/internal.ts"), "docs/../src/core/internal.ts");
});

// --- discovery -------------------------------------------------------------------------------

test("finds the installed pi package copy and the documentation entries it exposes", async (t) => {
  const { dir, roots, packageRoot } = await docsFixture();
  t.after(() => cleanupFixture(dir));

  const location = await docsLocation(roots);
  assert.equal(location.packageRoot, packageRoot);
  assert.equal(location.version, "1.4.0");
  assert.equal(location.which, "install");
  assert.deepEqual(location.entries, ["README.md", "CHANGELOG.md", "docs", "examples"]);
});

test("prefers the newest release directory (numerically, not alphabetically)", async (t) => {
  const older = PKG_REL.replace("1.4.0", "1.9.0");
  const newer = PKG_REL.replace("1.4.0", "1.10.0");
  const dir = await makeFixture({
    [`${older}/package.json`]: JSON.stringify({ name: PI_PACKAGE_NAME, version: "1.9.0" }),
    [`${older}/docs/tools.md`]: "old tools",
    [`${newer}/package.json`]: JSON.stringify({ name: PI_PACKAGE_NAME, version: "1.10.0" }),
    [`${newer}/docs/tools.md`]: "new tools",
    "project/src/index.ts": "",
  });
  t.after(() => cleanupFixture(dir));

  const location = await docsLocation({
    agentDir: path.join(dir, "agent"),
    cwd: path.join(dir, "project"),
    homeDir: path.join(dir, "home"),
  });
  assert.equal(location.version, "1.10.0");
  assert.equal(location.packageRoot, path.join(dir, newer));
});

test("a package copy without any documented entry is not a documentation location", async (t) => {
  const dir = await makeFixture({
    "agent/install/releases/1.0.0/node_modules/@earendil-works/pi-coding-agent/package.json": JSON.stringify({
      name: PI_PACKAGE_NAME,
      version: "1.0.0",
    }),
    "agent/install/releases/1.0.0/node_modules/@earendil-works/pi-coding-agent/src/core/internal.ts": "internal",
    "project/src/index.ts": "",
  });
  t.after(() => cleanupFixture(dir));

  const locations = await discoverPiDocs({
    agentDir: path.join(dir, "agent"),
    cwd: path.join(dir, "project"),
    homeDir: path.join(dir, "home"),
  });
  assert.equal(locations.some((l) => l.which !== "module"), false, "fixture copy must be skipped");
});

// --- listing -------------------------------------------------------------------------------

test("listing with no path shows the docs and examples tree, never the package's own source", async (t) => {
  const { dir, roots } = await docsFixture();
  t.after(() => cleanupFixture(dir));

  const listing = asListing(await readPiDocs(await docsLocation(roots), undefined));
  const paths = listing.entries.map((e) => e.path);

  assert.ok(paths.includes("README.md"), paths.join("\n"));
  assert.ok(paths.includes("CHANGELOG.md"), paths.join("\n"));
  assert.ok(paths.includes("docs"), paths.join("\n"));
  assert.ok(paths.includes("docs/extensions.md"), paths.join("\n"));
  assert.ok(paths.includes("docs/tools.md"), paths.join("\n"));
  assert.ok(paths.includes("examples/extensions/hello.ts"), paths.join("\n"));
  assert.equal(listing.entries.some((e) => e.path.startsWith("src/")), false);
  assert.equal(listing.entries.some((e) => e.path.startsWith("dist/")), false);
  assert.equal(listing.entries.some((e) => e.path === "package.json"), false);
  assert.equal(listing.truncated, false);
});

test("listing a documentation subdirectory lists it relative to that directory", async (t) => {
  const { dir, roots } = await docsFixture();
  t.after(() => cleanupFixture(dir));

  const listing = asListing(await readPiDocs(await docsLocation(roots), "docs"));
  assert.deepEqual(
    listing.entries.map((e) => e.path),
    ["extensions.md", "tools.md"]
  );
  assert.equal(listing.path, "docs");
});

test("a docs directory can be listed recursively and reports truncation", async (t) => {
  const { dir, roots } = await docsFixture();
  t.after(() => cleanupFixture(dir));

  const location = await docsLocation(roots);
  const all = asListing(await readPiDocs(location, "docs", { maxDepth: 4 }));
  assert.equal(all.entries.length, 2);

  const capped = asListing(await readPiDocs(location, "docs", { maxResults: 1 }));
  assert.equal(capped.entries.length, 1);
  assert.equal(capped.truncated, true);
});

// --- reading -------------------------------------------------------------------------------

test("reads a docs page with read's line numbering", async (t) => {
  const { dir, roots } = await docsFixture();
  t.after(() => cleanupFixture(dir));

  const content = asFile(await readPiDocs(await docsLocation(roots), "docs/extensions.md"));
  assert.deepEqual(
    content.lines.map((l) => `${l.line}:${l.text}`),
    ["1:# Extensions", "2:extension api"]
  );
  assert.equal(content.totalLines, 2);
  assert.equal(content.truncated, false);
});

test("offset and limit window a docs page the same way read does", async (t) => {
  const { dir, roots } = await docsFixture();
  t.after(() => cleanupFixture(dir));

  const content = asFile(await readPiDocs(await docsLocation(roots), "docs/extensions.md", { offset: 2, limit: 1 }));
  assert.deepEqual(content.lines.map((l) => `${l.line}:${l.text}`), ["2:extension api"]);
});

test("a missing documentation path is reported as a miss, not as a host path", async (t) => {
  const { dir, roots } = await docsFixture();
  t.after(() => cleanupFixture(dir));

  await assert.rejects(
    async () => readPiDocs(await docsLocation(roots), "docs/nope.md"),
    /"docs\/nope\.md" does not exist in Pi 1\.4\.0's documentation/
  );
});

// --- scope -------------------------------------------------------------------------------

test("everything in the package except README.md, CHANGELOG.md, docs/ and examples/ is out of scope", async (t) => {
  const { dir, roots } = await docsFixture();
  t.after(() => cleanupFixture(dir));

  const location = await docsLocation(roots);
  for (const target of [
    "src/core/internal.ts",
    "dist/built.js",
    "package.json",
    "../outside/secret.txt",
    "/etc/passwd",
  ]) {
    await assert.rejects(
      () => readPiDocs(location, target),
      /is not part of Pi's documentation/,
      `expected ${target} to be out of scope`
    );
  }
});

test("a path that re-enters the package outside the allowlist is rejected, not resolved", async (t) => {
  const { dir, roots } = await docsFixture();
  t.after(() => cleanupFixture(dir));

  const location = await docsLocation(roots);
  for (const target of ["docs/../src/core/internal.ts", "examples/../src/core/internal.ts", "docs/../package.json"]) {
    await assert.rejects(
      () => readPiDocs(location, target),
      /is not part of Pi's documentation/,
      `expected ${target} to be out of scope`
    );
  }
});

test("a path that leaves the package root is rejected by the sandbox, not just by the allowlist", async (t) => {
  const { dir, roots } = await docsFixture();
  t.after(() => cleanupFixture(dir));

  const location = await docsLocation(roots);
  for (const target of ["docs/../../outside/secret.txt", "docs/../../../../../../etc/passwd"]) {
    await assert.rejects(() => readPiDocs(location, target), SandboxError, `expected ${target} to be rejected`);
  }
});

test("a symlink inside docs/ that points outside the package root is rejected", async (t) => {
  const { dir, roots } = await docsFixture();
  t.after(() => cleanupFixture(dir));

  const packageRoot = path.join(dir, PKG_REL);
  if (!(await trySymlink(t, path.join(dir, "outside", "secret.txt"), path.join(packageRoot, "docs", "link.md")))) return;

  await assert.rejects(async () => readPiDocs(await docsLocation(roots), "docs/link.md"), SandboxError);
});

test("a symlink inside docs/ that points into the package's own source is still out of scope", async (t) => {
  const { dir, roots } = await docsFixture();
  t.after(() => cleanupFixture(dir));

  const packageRoot = path.join(dir, PKG_REL);
  // Stays inside the package root, so containment alone would accept it: only the allowlist re-checked
  // against the resolved path rejects it.
  if (!(await trySymlink(t, path.join(packageRoot, "src", "core", "internal.ts"), path.join(packageRoot, "docs", "leak.md"))))
    return;

  await assert.rejects(async () => readPiDocs(await docsLocation(roots), "docs/leak.md"), /is not part of Pi's documentation/);
});

test("protected policy paths are blocked inside the docs tree as well", async (t) => {
  const { dir, roots } = await docsFixture({
    [`${PKG_REL}/docs/.env`]: "SECRET=1",
    [`${PKG_REL}/docs/node_modules/dep/leak.md`]: "leaked",
  });
  t.after(() => cleanupFixture(dir));

  const location = await docsLocation(roots);
  await assert.rejects(() => readPiDocs(location, "docs/.env"), /restricted by the sandbox/);
  await assert.rejects(() => readPiDocs(location, "docs/node_modules/dep/leak.md"), /restricted by the sandbox/);

  // Same rule as `list`: rejected paths are not even named in a listing.
  const listing = asListing(await readPiDocs(location, "docs"));
  assert.deepEqual(
    listing.entries.map((e) => e.path),
    ["extensions.md", "tools.md"]
  );
});
