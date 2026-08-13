import { Type } from "typebox";

export const READ_TOOL_DEFINITION = {
  name: "read",
  label: "Read",
  description:
    "Read a text file's contents, numbered by line. Output is capped at 2000 lines or 50KB (whichever is hit first); use offset/limit to read a specific range or continue past a truncation.",
  promptSnippet: "read: view a text file's contents, numbered by line (bash is disabled)",
  promptGuidelines: [
    "Use read to view a file's contents instead of a bash `cat`/`sed` command — bash is disabled in this project.",
    "Lines are 1-indexed, matching the line numbers grep reports and insert expects.",
    "If you have identified interesting lines with grep and want more context, use the offset and limit parameters.",
    "When a result is truncated, pass the suggested offset to continue reading from where the previous call left off.",
  ],
  parameters: Type.Object({
    path: Type.String({ description: "Path to the file to read, relative to the project root." }),
    offset: Type.Optional(
      Type.Integer({ minimum: 1, description: "1-indexed line number to start reading from. Defaults to 1." })
    ),
    limit: Type.Optional(Type.Integer({ minimum: 1, description: "Maximum number of lines to read." })),
  }),
};
