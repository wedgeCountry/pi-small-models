import { Type } from "typebox";
import { INJECTION_GUARD_GUIDELINES } from "./injectionGuard.ts";

export const GIT_DIFF_TOOL_DEFINITION = {
  name: "git_diff",
  label: "Git Diff",
  description:
    "Show changes against the last commit (staged and unstaged alike) as a unified diff, or just the names of the changed files with nameOnly.",
  promptGuidelines: INJECTION_GUARD_GUIDELINES,

  parameters: Type.Object({
    path: Type.Optional(
      Type.String({
        description: "Limit the diff to this file or directory, relative to the project root. Defaults to the whole repository.",
      })
    ),
    nameOnly: Type.Optional(
      Type.Boolean({
        description:
          "List only the changed file paths, one per line, without the diff body. Use it to see which files changed before asking for their diff. Defaults to false.",
        default: false,
      })
    ),
  }),
};
