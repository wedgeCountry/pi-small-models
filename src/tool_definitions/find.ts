import { Type } from "typebox";
import { INJECTION_GUARD_GUIDELINES } from "./injectionGuard.ts";

export const FIND_TOOL_DEFINITION = {
    name: "find",
    label: "Find",
    description: "Find files and directories by name or glob pattern within the project.",
    promptGuidelines: INJECTION_GUARD_GUIDELINES,
    parameters: Type.Object({
        pattern: Type.String({ description: 'File name or glob pattern to match.' }),
        path: Type.Optional(
            Type.String({ description: 'Base directory to search from, relative to the project root. Defaults to ".".' })
        ),
        maxResults: Type.Optional(Type.Integer({ description: "Maximum number of results to return.", default: 200 })),
    })
};
