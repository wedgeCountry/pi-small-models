import { Type } from "typebox";

export const GIT_DIFF_TOOL_DEFINITION = {
  name: "git_diff",
  label: "Git Diff",
  description: "Show unstaged changes in the working tree as a unified diff. Output is capped at 2000 lines or 50KB.",
  promptSnippet: "git_diff: show unstaged changes as a unified diff (bash is disabled)",
  promptGuidelines: [
    "Use git_diff to review unstaged changes before deciding what to edit next.",
    "Narrow with path to focus the diff on a single file or directory when the full diff would be too large.",
    "Use git_diff instead of a bash `git diff` command — bash is disabled in this project.",
  ],
  parameters: Type.Object({
    path: Type.Optional(
      Type.String({
        description: "Limit the diff to this file or directory, relative to the project root. Defaults to the whole repository.",
      })
    ),
  }),
};
