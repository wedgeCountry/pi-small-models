import { Type } from "typebox";
import { uncappedParam } from "../backend/capOutput.ts";

export const PI_SKILLS_TOOL_DEFINITION = {
  name: "pi_skills",
  label: "Pi Skills",
  description:
    "List the skills Pi discovered (they live outside the project, so read cannot reach them), or read one skill's " +
    "SKILL.md and bundled files. Omit skill to list all.",
  promptGuidelines: [
    "Call pi_skills with no arguments first to get exact names and paths; reads stay inside the one skill directory named.",
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
    uncapped: uncappedParam,
  }),
};
