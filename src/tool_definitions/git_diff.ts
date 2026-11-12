import { Type } from "typebox";
import { uncappedParam } from "../backend/capOutput.ts";

export const GIT_DIFF_TOOL_DEFINITION = {
  name: "git_diff",
  label: "Git Diff",
  description:
    "Show changes against the last commit (staged and unstaged alike) as a unified diff, or just the names of the changed files with nameOnly.",
  parameters: Type.Object({
    path: Type.Optional(
      Type.String({
        description: "Limit the diff to this file or directory (project-relative). Defaults to the whole repository.",
      })
    ),
    nameOnly: Type.Optional(
      Type.Boolean({
        description: "List only changed file paths, no diff body — a cheap \"what changed?\" step. Defaults to false.",
        default: false,
      })
    ),
    uncapped: uncappedParam,
  }),
};
