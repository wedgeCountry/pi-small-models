# Tool Definitions

Static definition objects for each tool. One file per tool.

## Format
Each file exports a plain object:

```typescript
export const MY_TOOL_DEFINITION = {
  name: "my_tool",
  label: "My Tool",
  description: "What it does",
  promptSnippet: "my_tool: one-line hint",
  promptGuidelines: ["Use my_tool when ..."],
  parameters: Type.Object({ ... }),
};
```

## Available Tools
`find`, `grep`, `edit`, `mkdir`, `remove`, `copy`, `move`, `lstat`, `insert`, `list`, `read`, `write`, `git_status`, `git_diff`, `git_log`, `find_usages`, `peek`, `pi_docs`, `pi_skills`, `search`

## Important
- No logic here — pure data
- Keep in sync with corresponding `../tools/` implementation
- Used by the model to understand tool capabilities
