import { Type } from "typebox";

export const GIT_DIFF_TOOL_DEFINITION = {
  name: "git_diff",
  label: "Git Diff",
  description: "Show unstaged changes in the working tree as a unified diff.",
  parameters: Type.Object({
    path: Type.Optional(
      Type.String({
        description: "Limit the diff to this file or directory, relative to the project root. Defaults to the whole repository.",
      })
    ),
  }),
};
