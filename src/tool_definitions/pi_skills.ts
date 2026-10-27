import { Type } from "typebox";

export const PI_SKILLS_TOOL_DEFINITION = {
  name: "pi_skills",
  label: "Pi Skills",
  description:
    "List the skills Pi has discovered, or read one skill's SKILL.md and the files it bundles. Skills live outside the " +
    "project (Pi's agent directory, ~/.agents/skills, installed packages, the project's .agents/skills), so they are not " +
    "reachable through read. Omit skill to get the list of names, descriptions and SKILL.md paths.",
  promptSnippet:
    "pi_skills: no arguments lists every discovered skill (name, description, SKILL.md path); skill=\"name\" reads that " +
    "SKILL.md; skill+path reads a file bundled with that skill",
  promptGuidelines: [
    "Use pi_skills when a skill listed in <available_skills> mentions a reference file or script you need, or when you " +
      "must see a skill's own instructions before following them.",
    "Call pi_skills with no arguments first to get the exact names and paths; a skill can also be named by its directory.",
    "pi_skills is read-only and reaches only files inside the one skill directory you asked for.",
  ],
  parameters: Type.Object({
    skill: Type.Optional(
      Type.String({
        description:
          'Skill name (e.g. "pdf-tools") or the skill\'s directory path as reported by the skill listing. Omit to list all discovered skills.'
      })
    ),
    path: Type.Optional(
      Type.String({
        description:
          'File inside that skill folder, relative to the skill directory — e.g. "references/formats.md", ' +
          '"scripts/extract.sh". Defaults to "SKILL.md". Requires skill.',
      })
    ),
    offset: Type.Optional(
      Type.Integer({ minimum: 1, description: "1-indexed line number to start reading from. Defaults to 1." })
    ),
    limit: Type.Optional(Type.Integer({ minimum: 1, description: "Maximum number of lines to read." })),
  }),
};
