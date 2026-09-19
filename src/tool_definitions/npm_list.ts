import { Type } from "typebox";

export const NPM_LIST_TOOL_DEFINITION = {
    name: "npm_list",
    label: "npm list",
    description: "List installed npm packages and their dependencies. Use to check what packages are installed, verify dependency versions, or debug missing package errors.",
    promptSnippet: "npm_list: list installed npm packages (bash is disabled)",
    promptGuidelines: [
        "Use npm_list to check what packages are installed in the project.",
        "Use npm_list to verify a specific package is installed or check its version.",
        "Use npm_list to debug 'module not found' or 'unknown file extension' errors.",
    ],
    parameters: Type.Object({
        depth: Type.Optional(Type.Integer({ description: "Dependency depth to show. 0 = top-level only, 1 = one level deep, etc. Use 0 to check if a package is installed at the top level. Defaults to showing full tree.", default: 0 })),
        package: Type.Optional(Type.String({ description: "Optional package name to filter results. If provided, only shows that package and its dependencies." })),
        long: Type.Optional(Type.Boolean({ description: "Show extended info (version, description). Defaults to false.", default: false })),
    })
};