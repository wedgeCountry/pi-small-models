import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  discoverSkills,
  discoverSkillsCached,
  resetSkillsCache,
  type PiResourceRoots,
  type SkillLocation,
} from "../src/sandbox/piRoots.ts";
import { formatSkillListing, readSkillFile, resolveSkillRequest } from "../src/tools/pi_skills.ts";
import { SandboxError } from "../src/sandbox/sandbox.ts";
import { makeFixture, cleanupFixture } from "./fixtures.ts";

function skillFile(name: string, description: string, body = `# ${name}\n\nUse this skill.\n`): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}`;
}

/**
 * A fixture with one skill in every kind of location `pi_skills` knows about: user (`<agentDir>/skills`
 * and `~/.agents/skills`), package (`<agentDir>/npm/node_modules/<pkg>/skills`), and project
 * (`.agents/skills`, `.pi/skills`). The project's `.git` is what stops the ancestor walk, so a skill
 * sitting above the repository must stay invisible. `agentDir` and `homeDir` are fixtures too, so no
 * real skill on this machine can leak into an assertion.
 */
async function skillsFixture(): Promise<{ dir: string; roots: PiResourceRoots }> {
  const dir = await makeFixture({
    "project/.git/HEAD": "ref: refs/heads/main\n",
    "project/.agents/skills/project-skill/SKILL.md": skillFile("project-skill", "Always load for this project"),
    "project/.agents/skills/project-skill/references/guide.md": "# Guide\nfollow the guide",
    "project/.agents/skills/project-skill/node_modules/evil/index.js": "process.exit(1)",
    "project/.agents/skills/plain-skill/SKILL.md": "# Plain skill\nno frontmatter here",
    "project/.agents/skills/not-a-skill/notes.md": "just a folder, not a skill",
    "project/.pi/skills/pi-settings/SKILL.md": skillFile("Pi Settings", "Configure settings.json"),
    "project/packages/app/src/index.ts": "console.log(1)",

    "agent/skills/user-skill/SKILL.md": skillFile("user-skill", "A skill from the agent directory"),
    "agent/npm/node_modules/pi-brain/skills/brain/SKILL.md": skillFile("brain", "Brain agent memory management"),
    "agent/npm/node_modules/@scope/pi-pkg/skills/scoped-skill/SKILL.md": skillFile(
      "scoped-skill",
      "Skill inside a scoped package"
    ),

    "home/.agents/skills/agent-skill/SKILL.md": skillFile("agent-skill", "Personal skill"),

    // Above the repository root: must never be discovered from a project cwd.
    ".agents/skills/outside-repo-skill/SKILL.md": skillFile("outside-repo-skill", "Must not be found"),
    "outside/secret.txt": "outside secret",
  });
  const roots: PiResourceRoots = {
    agentDir: path.join(dir, "agent"),
    cwd: path.join(dir, "project", "packages", "app"),
    homeDir: path.join(dir, "home"),
  };
  return { dir, roots };
}

/** `name|source|dir` per skill, dir made relative to the fixture, both sides sorted so order never matters. */
function snapshot(skills: SkillLocation[], dir: string): string[] {
  const prefix = dir.split(path.sep).join("/") + "/";
  return skills
    .map((s) => `${s.name}|${s.source}|${s.dir.split(path.sep).join("/")}`.split(prefix).join(""))
    .sort();
}

function named(skills: SkillLocation[], name: string): SkillLocation {
  const found = skills.find((s) => s.name === name);
  assert.ok(found, `no skill named ${name} in ${skills.map((s) => s.name).join(", ")}`);
  return found;
}

// --- discovery -------------------------------------------------------------------------------

test("discovers skills from the agent dir, the home dir, installed packages and the project, each tagged with where it came from", async (t) => {
  const { dir, roots } = await skillsFixture();
  t.after(() => cleanupFixture(dir));

  const expected = [
    "Pi Settings|project|project/.pi/skills/pi-settings",
    "agent-skill|user|home/.agents/skills/agent-skill",
    "brain|package|agent/npm/node_modules/pi-brain/skills/brain",
    "plain-skill|project|project/.agents/skills/plain-skill",
    "project-skill|project|project/.agents/skills/project-skill",
    "scoped-skill|package|agent/npm/node_modules/@scope/pi-pkg/skills/scoped-skill",
    "user-skill|user|agent/skills/user-skill",
  ].sort();

  assert.deepEqual(snapshot(await discoverSkills(roots), dir), expected);
});

test("a skill above the repository root is not discovered from a project cwd", async (t) => {
  const { dir, roots } = await skillsFixture();
  t.after(() => cleanupFixture(dir));

  const skills = await discoverSkills(roots);
  assert.equal(skills.some((s) => s.name === "outside-repo-skill"), false, "outside-repo-skill leaked past .git");
});

test("a folder is only a skill when it has a SKILL.md", async (t) => {
  const { dir, roots } = await skillsFixture();
  t.after(() => cleanupFixture(dir));

  const skills = await discoverSkills(roots);
  assert.equal(skills.some((s) => s.dir.endsWith(path.join("not-a-skill"))), false);
});

test("a SKILL.md with no frontmatter is named after its directory and has no description", async (t) => {
  const { dir, roots } = await skillsFixture();
  t.after(() => cleanupFixture(dir));

  const skill = named(await discoverSkills(roots), "plain-skill");
  assert.equal(skill.description, "", "a SKILL.md without frontmatter has no routing description");
  assert.ok(skill.skillFile.endsWith(path.join("plain-skill", "SKILL.md")));
});

test("discovery is capped, and the cap bounds how many files get read", async (t) => {
  const { dir, roots } = await skillsFixture();
  t.after(() => cleanupFixture(dir));

  assert.equal((await discoverSkills(roots, { maxSkills: 3 })).length, 3);
  assert.equal((await discoverSkills(roots, { maxSkills: 4 })).length, 4);
});

test("a skill inside node_modules is skipped, because pi_skills reads skills, not dependencies", async (t) => {
  const dir = await makeFixture({
    ".git/HEAD": "ref: refs/heads/main\n",
    ".agents/skills/real/SKILL.md": skillFile("real", "A real skill"),
    ".agents/skills/inner/node_modules/sneaky/SKILL.md": skillFile("sneaky", "A dependency pretending to be a skill"),
  });
  t.after(() => cleanupFixture(dir));

  const skills = await discoverSkills({ agentDir: path.join(dir, "agent"), cwd: dir, homeDir: path.join(dir, "home") });
  assert.deepEqual(skills.map((s) => s.name), ["real"]);
});

// --- resolving what was asked for ------------------------------------------------------------

test("a skill resolves by its frontmatter name, by its directory name and by the path it was listed at", async (t) => {
  const { dir, roots } = await skillsFixture();
  t.after(() => cleanupFixture(dir));

  const skills = await discoverSkills(roots);
  const project = named(skills, "project-skill");

  // Frontmatter name, case-insensitively.
  assert.equal(resolveSkillRequest(skills, "Project-Skill")!.skill.dir, project.dir);

  // Directory basename: a listing shows `.pi/skills/pi-settings` for a skill titled "Pi Settings", and
  // that is what the model will echo back.
  const settings = resolveSkillRequest(skills, "pi-settings")!.skill;
  assert.equal(settings.name, "Pi Settings");
  assert.ok(settings.dir.endsWith(path.join(".pi", "skills", "pi-settings")));

  // The `SKILL.md` path a listing showed.
  assert.equal(resolveSkillRequest(skills, project.skillFile)!.skill.dir, project.dir);
  assert.equal(resolveSkillRequest(skills, project.dir)!.skill.dir, project.dir);
});

test("an unknown skill name is answered with the skills that do exist", async (t) => {
  const { dir, roots } = await skillsFixture();
  t.after(() => cleanupFixture(dir));

  const skills = await discoverSkills(roots);
  assert.throws(() => resolveSkillRequest(skills, "no-such-skill", undefined), /Discovered skills:.*project-skill/);
});

test("two skills with the same name are refused rather than guessed at", async (t) => {
  const dir = await makeFixture({
    ".git/HEAD": "ref: refs/heads/main\n",
    ".agents/skills/dir-one/SKILL.md": skillFile("dup", "First dup"),
    "agent/skills/dir-two/SKILL.md": skillFile("dup", "Second dup"),
  });
  t.after(() => cleanupFixture(dir));

  const skills = await discoverSkills({ agentDir: path.join(dir, "agent"), cwd: dir, homeDir: path.join(dir, "home") });
  assert.equal(skills.length, 2);
  assert.throws(() => resolveSkillRequest(skills, "dup"), /"dup" matches 2 skills:/);
});

test("reading a bundled file requires naming the skill it belongs to", async (t) => {
  const { dir, roots } = await skillsFixture();
  t.after(() => cleanupFixture(dir));

  const skills = await discoverSkills(roots);
  assert.throws(
    () => resolveSkillRequest(skills, undefined, "references/guide.md"),
    /pi_skills needs "skill" when "path" is given/
  );
  const resolved = resolveSkillRequest(skills, "project-skill");
  assert.equal(resolved?.skill.name, "project-skill");
  assert.equal(resolved?.file, "SKILL.md"); // no file asked for -> the skill's SKILL.md
});

test("a bundled file path is always relative to its own skill directory", async (t) => {
  const { dir, roots } = await skillsFixture();
  t.after(() => cleanupFixture(dir));

  const skills = await discoverSkills(roots);
  const project = named(skills, "project-skill");

  assert.throws(
    () => resolveSkillRequest(skills, project.name, path.join(dir, "outside", "secret.txt")),
    /must be relative to the skill directory/
  );
  assert.throws(
    () => resolveSkillRequest(skills, project.name, "~/outside/secret.txt"),
    /must be relative to the skill directory/
  );
  // Shaped like a relative path, so it is accepted here and then rejected by the sandbox on read.
  const request = resolveSkillRequest(skills, project.name, "../../etc/passwd")!;
  assert.equal(request.file, "../../etc/passwd");
  await assert.rejects(() => readSkillFile(request.skill, request.file), SandboxError);
});

// --- reading skill files ---------------------------------------------------------------------

test("readSkillFile reads SKILL.md when no file is given", async (t) => {
  const { dir, roots } = await skillsFixture();
  t.after(() => cleanupFixture(dir));

  const skill = named(await discoverSkills(roots), "project-skill");
  const texts = (await readSkillFile(skill)).lines.map((l) => l.text);
  assert.equal(texts[0], "---");
  assert.ok(texts.includes("name: project-skill"), texts.join("\n"));
  assert.ok(texts.includes("description: Always load for this project"), texts.join("\n"));
});

test("readSkillFile reads a bundled file with read's line numbering", async (t) => {
  const { dir, roots } = await skillsFixture();
  t.after(() => cleanupFixture(dir));

  const skill = named(await discoverSkills(roots), "project-skill");
  const content = await readSkillFile(skill, "references/guide.md");
  assert.deepEqual(content.lines.map((l) => `${l.line}:${l.text}`), ["1:# Guide", "2:follow the guide"]);

  const windowed = await readSkillFile(skill, "references/guide.md", { offset: 2, limit: 1 });
  assert.deepEqual(windowed.lines.map((l) => `${l.line}:${l.text}`), ["2:follow the guide"]);
});

test("a skill's own node_modules is off limits, exactly as it is in a project", async (t) => {
  const { dir, roots } = await skillsFixture();
  t.after(() => cleanupFixture(dir));

  const skill = named(await discoverSkills(roots), "project-skill");
  await assert.rejects(() => readSkillFile(skill, "node_modules/evil/index.js"), /restricted by the sandbox/);
});

test("a bundled file cannot walk out of the skill directory", async (t) => {
  const { dir, roots } = await skillsFixture();
  t.after(() => cleanupFixture(dir));

  const skill = named(await discoverSkills(roots), "project-skill");
  await assert.rejects(() => readSkillFile(skill, "../outside/secret.txt"), SandboxError);
  await assert.rejects(() => readSkillFile(skill, "../not-a-skill/notes.md"), SandboxError);
});

// --- listing -------------------------------------------------------------------------------

test("the listing names each skill, where it came from, what it is for and how to open it", async (t) => {
  const { dir, roots } = await skillsFixture();
  t.after(() => cleanupFixture(dir));

  const text = formatSkillListing(await discoverSkills(roots));

  assert.ok(text.includes("project-skill [project]"), text);
  assert.ok(text.includes("Always load for this project"), text);
  assert.ok(text.includes("brain [package]"), text);
  assert.ok(text.includes("agent-skill [user]"), text);
  assert.ok(text.includes(path.join("project", ".agents", "skills", "project-skill", "SKILL.md")), text);
  assert.ok(text.includes('Read one with pi_skills(skill="name")'), text);
  assert.ok(text.includes("plain-skill [project]"), text); // no description, still listed
});

test("the listing shows where the truncation happened and how many skills exist", async (t) => {
  const { dir, roots } = await skillsFixture();
  t.after(() => cleanupFixture(dir));

  const text = formatSkillListing(await discoverSkills(roots), 2);
  assert.ok(text.includes("Skills Pi can load (7):"), text);
  assert.ok(text.includes("… 5 more skill(s) not listed"), text);
});

// --- caching -------------------------------------------------------------------------------

test("skill discovery is cached per roots, and resetSkillsCache makes a newly installed skill visible", async (t) => {
  const { dir, roots } = await skillsFixture();
  t.after(() => cleanupFixture(dir));
  t.after(() => resetSkillsCache());

  const before = await discoverSkillsCached(roots);
  assert.equal(before.some((s) => s.name === "fresh-skill"), false);

  const newSkillDir = path.join(dir, "project", ".agents", "skills", "fresh-skill");
  await fs.mkdir(newSkillDir, { recursive: true });
  await fs.writeFile(path.join(newSkillDir, "SKILL.md"), skillFile("fresh-skill", "Just installed"));

  const cached = await discoverSkillsCached(roots);
  assert.equal(cached.some((s) => s.name === "fresh-skill"), false, "the cache must survive repeat calls in one session");

  resetSkillsCache();
  const refreshed = await discoverSkillsCached(roots);
  assert.equal(refreshed.some((s) => s.name === "fresh-skill"), true, "a reset must re-scan the skill roots");
});
