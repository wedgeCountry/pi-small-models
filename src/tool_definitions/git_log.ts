import { Type } from "typebox";

export const GIT_LOG_TOOL_DEFINITION = {
  name: "git_log",
  label: "Git Log",
  description:
    "Show recent commits (newest first): hash, author, date, subject, and the files each commit changed. " +
    "Defaults to the last 10 commits; use maxCount: 1 for just the latest commit.",
  promptSnippet: "git_log: show recent commits and the files they changed (bash is disabled)",
  promptGuidelines: [
    "Use git_log to find out what the last commit(s) were, who made them, and which files they touched.",
    "Pass maxCount: 1 to see only the latest commit; pass path to see only commits touching a file or directory.",
    "Use git_log instead of a bash `git log` or `git show` command — bash is disabled in this project.",
  ],
  parameters: Type.Object({
    maxCount: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: 50,
        description: "Maximum number of commits to return. Defaults to 10, capped at 50.",
      })
    ),
    path: Type.Optional(
      Type.String({
        description: "Only show commits touching this file or directory, relative to the project root. Defaults to the whole repository.",
      })
    ),
  }),
};
