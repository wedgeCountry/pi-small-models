import * as path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { PI_SKILLS_TOOL_DEFINITION } from "../tool_definitions/pi_skills.ts";
import {
  discoverSkillsCached,
  readOnlySandbox,
  type SkillLocation,
} from "../sandbox/piRoots.ts";
import type { ToolRegistry } from "../sandbox/permissionGate.ts";
import { callName, oneLine } from "../backend/renderCall.ts";
import { withConciseValidationErrors } from "../backend/toolValidation.ts";
import { toolError } from "../backend/formatError.ts";
import { readFile, type ReadResult } from "./read.ts";

const LISTING_MAX_SHOWN = 60;
const NAME_HINT_MAX = 30;

export interface PiSkillsOptions {
  offset?: number;
  limit?: number;
  signal?: AbortSignal;
}

/** What `skill`/`path` resolve to: one discovered skill plus one file inside its own directory. */
export interface ResolvedSkillRequest {
  skill: SkillLocation;
  file: string;
}

/**
 * Turn the model's `skill`/`path` arguments into a concrete skill plus a file inside it, or `undefined`
 * when no skill was asked for (which means "list them").
 *
 * A skill is matched by frontmatter name, by its directory's name, or by the directory (or `SKILL.md`)
 * path the listing reported — all compared case-insensitively with trailing slashes and a trailing
 * `SKILL.md` removed, so the exact string the listing printed always works. Ambiguity and misses are
 * errors that tell the model what to pass instead, because silently picking one of several same-named
 * skills would read the wrong instructions.
 */
export function resolveSkillRequest(
  skills: SkillLocation[],
  skill: string | undefined,
  file: string | undefined,
  cwd?: string
): ResolvedSkillRequest | undefined {
  const query = (skill ?? "").trim();
  if (query === "") {
    if ((file ?? "").trim() !== "") {
      throw toolError(
        "pi_skills",
        'pi_skills needs "skill" when "path" is given: "path" is a file inside that skill\'s own folder.',
        { path: file }
      );
    }
    return undefined;
  }

  const matches = findSkills(skills, query, cwd);
  if (matches.length === 0) {
    throw toolError("pi_skills", `No skill named "${query}". ${describeOtherSkills(skills)}`, { skill: query });
  }
  if (matches.length > 1) {
    throw toolError(
      "pi_skills",
      `"${query}" matches ${matches.length} skills:\n${matches.map((m) => `  ${m.skillFile}`).join("\n")}\n` +
        'Pass one of those paths as "skill" to choose.',
      { skill: query }
    );
  }

  const relativeFile = (file ?? "").trim() === "" ? "SKILL.md" : (file as string).trim();
  const matched = matches[0]!;
  if (path.isAbsolute(relativeFile) || relativeFile.startsWith("~")) {
    throw toolError(
      "pi_skills",
      `"path" must be relative to the skill directory ${matched.dir}, got "${relativeFile}".`,
      { skill: query, path: relativeFile }
    );
  }

  return { skill: matched, file: relativeFile };
}

/**
 * Match one query against a skill's frontmatter name, its directory's basename, or the directory /
 * `SKILL.md` path a listing reported. A query that is a path relative to `cwd` (a path the model read
 * from `AGENTS.md`, `find` output or a previous listing) is resolved against `cwd` first, so
 * `.agents/skills/foo/SKILL.md` works as well as the absolute path the listing printed. All
 * comparisons are case-insensitive, with backslashes unified, a trailing slash dropped and a trailing
 * `SKILL.md` removed — i.e. the same shape the listing shows in several forms.
 */
function findSkills(skills: SkillLocation[], query: string, cwd?: string): SkillLocation[] {
  const wanted = normalizeSkillKey(query);
  const wantedPath = path.isAbsolute(query)
    ? wanted
    : cwd
      ? normalizeSkillKey(path.resolve(cwd, query))
      : undefined;

  return skills.filter((s) =>
    [s.name, path.basename(s.dir), s.dir, s.skillFile].some((candidate) => {
      const key = normalizeSkillKey(candidate);
      return key === wanted || (wantedPath !== undefined && key === wantedPath);
    })
  );
}

function normalizeSkillKey(value: string): string {
  return value
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .replace(/\/SKILL\.md$/i, "")
    .toLowerCase();
}

function describeOtherSkills(skills: SkillLocation[]): string {
  if (skills.length === 0) {
    return "Pi has discovered no skills (Pi's agent directory, ~/.agents/skills, installed pi packages, and the project's .agents/skills and .pi/skills folders were all searched).";
  }
  const names = skills.slice(0, NAME_HINT_MAX).map((s) => s.name);
  const more = skills.length - names.length;
  return `Discovered skills: ${names.join(", ")}${more > 0 ? `, … ${more} more` : ""}. Call pi_skills with no arguments for the full list.`;
}

/**
 * Read one file of a skill. The skill's own directory is the sandbox root, so the file can move around
 * inside that skill (bundled references, scripts) but can never leave it, and the skill directory's own
 * `.git/`, `.env*` or `node_modules/` stay blocked by `policy.ts` like anywhere else.
 */
export async function readSkillFile(
  skill: SkillLocation,
  file: string = "SKILL.md",
  opts: PiSkillsOptions = {}
): Promise<ReadResult> {
  return readFile(readOnlySandbox(skill.dir), file, { offset: opts.offset, limit: opts.limit, signal: opts.signal });
}

/** The listing the model sees when it calls `pi_skills` with no arguments. */
export function formatSkillListing(skills: SkillLocation[], maxShown = LISTING_MAX_SHOWN): string {
  if (skills.length === 0) return describeOtherSkills([]);

  const shown = skills.slice(0, maxShown);
  const lines = shown.map(
    (s, i) => `${i + 1}. ${s.name} [${s.source}]\n   ${s.description || "(no description)"}\n   ${s.skillFile}`
  );
  if (skills.length > shown.length) lines.push(`… ${skills.length - shown.length} more skill(s) not listed`);
  lines.push('Read one with pi_skills(skill="name"); the SKILL.md path works as "skill" too, and "path" reads a file bundled with that skill.');
  return `Skills Pi can load (${skills.length}):\n${lines.join("\n")}`;
}

function renderSkillFile(request: ResolvedSkillRequest, result: ReadResult): string {
  const header = `${request.file} of "${request.skill.name}" [${request.skill.source}] (${request.skill.dir}):`;
  let text = result.lines.map((l) => `${l.line}:${l.text}`).join("\n");
  if (result.truncated) {
    const lastLine = result.lines[result.lines.length - 1]?.line ?? 0;
    text += `\n\n[Showing lines ${result.lines[0]?.line ?? 1}-${lastLine} of ${result.totalLines}. Use offset=${lastLine + 1} to continue.]`;
  }
  return `${header}\n${text}`;
}

/**
 * Registered directly on `pi`, not through the gated registry — same reasoning as `pi_docs`
 * (`src/tools/pi_docs.ts`): the roots are Pi's own skill directories discovered by Pi itself, every read
 * is containment-checked against the single skill directory asked for, and `/toggle-sandbox off` should
 * not turn every skill lookup into a confirmation dialog.
 */
export function registerPiSkillsTool(pi: ToolRegistry) {
  pi.registerTool({
    ...PI_SKILLS_TOOL_DEFINITION,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    prepareArguments: withConciseValidationErrors(
      PI_SKILLS_TOOL_DEFINITION.name,
      PI_SKILLS_TOOL_DEFINITION.parameters
    ),
    renderCall(args, theme) {
      const skill = (args.skill ?? "").trim();
      let text = `${callName(theme, "pi_skills")} ${theme.fg("accent", skill === "" ? "(list)" : skill)}`;
      if ((args.path ?? "").trim() !== "") text += theme.fg("toolOutput", `:${String(args.path).trim()}`);
      return oneLine(text);
    },
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const skills = await discoverSkillsCached({ agentDir: getAgentDir(), cwd: ctx.cwd });
      const request = resolveSkillRequest(skills, params.skill, params.path, ctx.cwd);

      if (!request) {
        return {
          content: [{ type: "text", text: formatSkillListing(skills) }],
          details: {
            kind: "list",
            count: skills.length,
            skills: skills.map((s) => ({ name: s.name, source: s.source, skillFile: s.skillFile })),
          },
        };
      }

      const result = await readSkillFile(request.skill, request.file, {
        offset: params.offset,
        limit: params.limit,
        signal,
      });
      return {
        content: [{ type: "text", text: renderSkillFile(request, result) }],
        details: {
          kind: "file",
          skill: request.skill.name,
          source: request.skill.source,
          dir: request.skill.dir,
          file: request.file,
          totalLines: result.totalLines,
          truncated: result.truncated,
        },
      };
    },
  });
}
