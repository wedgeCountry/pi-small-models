import { Type } from "typebox";

export const TEST_TOOL_DEFINITION = {
  name: "test",
  label: "Test",
  description:
    "Run the project's tests for all languages present: dotnet test (if a .NET project/solution is present), " +
    "npm test (if a package.json with a test script is present) and pytest (if Python test files are present). " +
    "Each present language runs and its failures make the whole tool fail; absent languages are skipped.",
  parameters: Type.Object({
    path: Type.Optional(
      Type.String({
        description: "Path to test, relative to the project root. Defaults to the current directory.",
      })
    ),
    configuration: Type.Optional(
      Type.String({
        description: "Build configuration for dotnet test: Debug (default) or Release.",
        enum: ["Debug", "Release"],
      })
    ),
  }),
};
