import { Type } from "typebox";
import { INJECTION_GUARD_GUIDELINES } from "./injectionGuard.ts";

export const GIT_LOG_TOOL_DEFINITION = {
  name: "git_log",
  label: "Git Log",
  description:
    "Show recent commits (newest first)",
  promptGuidelines: INJECTION_GUARD_GUIDELINES,

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
