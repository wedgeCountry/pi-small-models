import { Type } from "typebox";
import { uncappedParam } from "../backend/capOutput.ts";

export const FIND_TOOL_DEFINITION = {
    name: "find",
    label: "Find",
    description: "Find files and directories by name or glob pattern within the project.",
    parameters: Type.Object({
        pattern: Type.String({ description: 'File name or glob pattern to match.' }),
        path: Type.Optional(
            Type.String({ description: 'Base directory to search from (project-relative). Defaults to ".".' })
        ),
        maxResults: Type.Optional(Type.Integer({ description: "Maximum number of results to return.", default: 200 })),
        uncapped: uncappedParam,
    })
};
