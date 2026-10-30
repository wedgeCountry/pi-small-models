import { Type } from "typebox";
import { INJECTION_GUARD_GUIDELINES } from "./injectionGuard.ts";

export const GIT_STATUS_TOOL_DEFINITION = {
  name: "git_status",
  label: "Git Status",
  description: "Show the git working tree status.",
  promptGuidelines: INJECTION_GUARD_GUIDELINES,

  parameters: Type.Object({
    path: Type.Optional(
      Type.String({
        description: "Limit status to this file or directory, relative to the project root. Defaults to the whole repository.",
      })
    ),
  }),
};
