import { Type } from "typebox";
import { INJECTION_GUARD_GUIDELINES } from "./injectionGuard.ts";

export const SEARCH_TOOL_DEFINITION = {
    name: "search",
    label: "Search",
    description: "Search for files and directories by name or glob pattern.",
    promptGuidelines: INJECTION_GUARD_GUIDELINES,
    parameters: Type.Object({
        pattern: Type.String({ description: 'Pattern to match, e.g. "*.ts" or "index.ts"' }),
        path: Type.Optional(
            Type.String({ description: 'Base directory to search from, relative to the project root. Defaults to ".".' })
        ),
        maxResults: Type.Optional(Type.Integer({ description: "Maximum number of results to return.", default: 200 })),
    })
};