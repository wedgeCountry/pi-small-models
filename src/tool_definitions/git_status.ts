import { Type } from "typebox";

export const GIT_STATUS_TOOL_DEFINITION = {
  name: "git_status",
  label: "Git Status",
  description: "Show the working tree status: current branch, ahead/behind counts, and changed/staged/untracked files.",
  promptSnippet: "git_status: show the current branch and changed/staged/untracked files (bash is disabled)",
  promptGuidelines: [
    "Use git_status to see what's changed before deciding what to edit, stage, or diff.",
    "Narrow with path to scope the status to a single file or directory.",
    "Use git_status instead of a bash `git status` command — bash is disabled in this project.",
  ],
  parameters: Type.Object({
    path: Type.Optional(
      Type.String({
        description: "Limit status to this file or directory, relative to the project root. Defaults to the whole repository.",
      })
    ),
  }),
};
