import { Type } from "typebox";
import { uncappedParam } from "../backend/capOutput.ts";

export const READ_TOOL_DEFINITION = {
  name: "read",
  label: "Read",
  description: "Read a text file. Returns content with 1-indexed line numbers.",
  promptGuidelines: ["Before using read, refer to the peek tool for an outline. Then decide if you need the full file contents."],
  parameters: Type.Object({
    path: Type.String({ description: "Path to the file to read (project-relative)." }),
    offset: Type.Optional(
      Type.Integer({ minimum: 1, description: "1-indexed line number to start reading from. Defaults to 1." })
    ),
    limit: Type.Optional(Type.Integer({ minimum: 1, description: "Maximum number of lines to read." })),
    uncapped: uncappedParam,
  }),
};
