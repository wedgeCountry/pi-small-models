import { Type } from "typebox";
import { uncappedParam } from "../backend/capOutput.ts";

export const PI_DOCS_TOOL_DEFINITION = {
  name: "pi_docs",
  label: "Pi Docs",
  description:
    "Read Pi's own documentation (README, docs, examples of the installed Pi package) for questions about pi itself. " +
    "Omit path to list available pages.",
  promptGuidelines: [
    "Use pi_docs for questions about pi itself instead of answering from memory; call with no arguments to list pages. " +
      "Read-only, limited to Pi's installed package.",
  ],
  parameters: Type.Object({
    path: Type.Optional(
      Type.String({
        description:
          'Doc path relative to Pi\'s package root, e.g. "docs/extensions.md", "README.md" or ' +
          '"examples/extensions/hello.ts". Only "README.md", "CHANGELOG.md", "docs/**" and "examples/**" are reachable. ' +
          'Omit it to list what is available.',
      })
    ),
    offset: Type.Optional(
      Type.Integer({ minimum: 1, description: "1-indexed line number to start reading from. Defaults to 1." })
    ),
    limit: Type.Optional(Type.Integer({ minimum: 1, description: "Maximum number of lines to read." })),
    uncapped: uncappedParam,
  }),
};
