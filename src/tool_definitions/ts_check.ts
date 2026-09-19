import { Type } from "typebox";

export const TS_CHECK_TOOL_DEFINITION = {
  name: "ts_check",
  label: "TypeScript Check",
  description: "Run TypeScript type checking using `tsc --noEmit`. Use to verify type correctness without emitting JavaScript files.",
  promptSnippet: "ts_check: run TypeScript type checking (bash is disabled)",
  promptGuidelines: [
    "Use ts_check to verify TypeScript types without generating output files.",
    "Specify a tsconfig.json path to use a specific configuration.",
    "Omit path to use the tsconfig.json in the current directory.",
    "Use ts_check instead of a bash `tsc --noEmit` command — bash is disabled in this project.",
    "Type checking is useful before committing changes or when refactoring code.",
  ],
  parameters: Type.Object({
    path: Type.Optional(
      Type.String({
        description: "Path to the tsconfig.json file to use, relative to the project root. Defaults to the current directory.",
      })
    ),
    project: Type.Optional(
      Type.String({
        description: "Compile the project given the path to its configuration file or to a folder with a 'tsconfig.json'. Same as --project flag.",
      })
    ),
    noEmit: Type.Optional(
      Type.Boolean({
        description: "Do not emit outputs. Defaults to true for this tool.",
        default: true,
      })
    ),
    pretty: Type.Optional(
      Type.Boolean({
        description: "Enable color and formatting in output. Defaults to true.",
        default: true,
      })
    ),
  }),
};