import { Type } from "typebox";

export const PI_DOCS_TOOL_DEFINITION = {
  name: "pi_docs",
  label: "Pi Docs",
  description:
    "Read Pi's own documentation: the README, docs pages and example extensions of the installed Pi package — the " +
    "files to read for questions about pi itself (extensions, tools, settings, keybindings, themes, skills, the SDK, " +
    "TUI components). Paths are relative to Pi's package root. Omit path to list every available page first.",
  promptSnippet:
    "pi_docs: read Pi's own documentation (README.md, docs/..., examples/...); no arguments lists the available pages",
  promptGuidelines: [
    "Use pi_docs whenever the question is about pi itself — how to write an extension, which tools exist, how settings " +
      "or skills work — instead of answering from memory.",
    "Call it with no arguments to see which pages exist, then read the page you need; follow the links it mentions.",
    "pi_docs is read-only and reaches only Pi's own installed package: it cannot read your project, your home folder " +
      "or anywhere else on the machine.",
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
  }),
};
