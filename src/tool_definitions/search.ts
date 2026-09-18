import { Type } from "typebox";

export const SEARCH_TOOL_DEFINITION = {
    name: "search",
    label: "Search",
    description: "Search for files and directories by name or glob pattern. Wrapper around find with simpler defaults.",
    promptSnippet: "search: locate files by name/glob pattern (wrapper around find)",
    promptGuidelines: [
        'Use search to locate files by name or glob pattern, e.g. "*.ts" or "**/index.ts".',
        'This is a simpler wrapper around find — use find directly if you need advanced glob patterns with **.',
    ],
    parameters: Type.Object({
        pattern: Type.String({ description: 'Pattern to match, e.g. "*.ts" or "index.ts"' }),
        path: Type.Optional(
            Type.String({ description: 'Base directory to search from, relative to the project root. Defaults to ".".' })
        ),
        maxResults: Type.Optional(Type.Integer({ description: "Maximum number of results to return.", default: 200 })),
    })
};