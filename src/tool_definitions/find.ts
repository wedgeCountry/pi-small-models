import { Type } from "typebox";

export const FIND_TOOL_DEFINITION = {
    name: "find",
    label: "Find",
    description: "Find files and directories by glob pattern within the project.",
    parameters: Type.Object({
        pattern: Type.String({ description: 'Glob pattern to match, e.g. "**/*.ts" or "src/**/index.ts"' }),
        path: Type.Optional(
            Type.String({ description: 'Base directory to search from, relative to the project root. Defaults to ".".' })
        ),
        maxResults: Type.Optional(Type.Integer({ description: "Maximum number of results to return.", default: 200 })),
    })
};
