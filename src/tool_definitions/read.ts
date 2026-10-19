import { Type } from "typebox";

export const READ_TOOL_DEFINITION = {
  name: "read",
  label: "Read",
  description: "Read a text file's contents, numbered by line. If you need to see the implementation details, use peek=false",
  parameters: Type.Object({
    path: Type.String({ description: "Path to the file to read, relative to the project root." }),
    offset: Type.Optional(
      Type.Integer({ minimum: 1, description: "1-indexed line number to start reading from. Defaults to 1." })
    ),
    limit: Type.Optional(Type.Integer({ minimum: 1, description: "Maximum number of lines to read." })),
    peek: Type.Optional(
      Type.Boolean({ 
        description: "If true, show a compact outline of the file instead of its contents. Defaults to true.",
        default: true,
      })
    ),
  }),
};
