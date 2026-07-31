import { Type } from "typebox";

export const FIND_TOOL_DEFINITION = {
    name: "find",
    label: "Find",
    description: "Find files and directories by glob pattern within the project. The search is recursive only if the provided glob includes the '**' wildcard; without it, only the top-level of the base directory is examined.",
    promptSnippet: "find: locate files by name/glob pattern (bash is disabled)",
    promptGuidelines: [
        'Use find to locate files by name or glob pattern, e.g. "**/*.test.ts".',
    ],
    parameters: Type.Object({
        pattern: Type.String({ description: 'Glob pattern to match, e.g. "**/*.ts" or "src/**/index.ts"' }),
        path: Type.Optional(
            Type.String({ description: 'Base directory to search from, relative to the project root. Defaults to ".".' })
        ),
        maxResults: Type.Optional(Type.Integer({ description: "Maximum number of results to return.", default: 200 })),
    })
};
