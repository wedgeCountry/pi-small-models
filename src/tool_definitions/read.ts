import { Type } from "typebox";

export const READ_TOOL_DEFINITION = {
  name: "read",
  label: "Read",
  description: "Read a text file's contents, numbered by line.",
  parameters: Type.Object({
    path: Type.String({ description: "Path to the file to read, relative to the project root." }),
    offset: Type.Optional(
      Type.Integer({ minimum: 1, description: "1-indexed line number to start reading from. Defaults to 1." })
    ),
    limit: Type.Optional(Type.Integer({ minimum: 1, description: "Maximum number of lines to read." })),
  }),
};
