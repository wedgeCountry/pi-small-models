# tool_definitions

One file per tool (`find`, `grep`, `edit`, `mkdir`, `remove`, `lstat`, `insert`, `list`, `read`, `write`), each exporting a plain
`*_TOOL_DEFINITION` object:

```typescript
export const MY_TOOL_DEFINITION = {
  name: "my_tool",
  label: "My Tool",
  description: "What it does",
  promptSnippet: "my_tool: one-line hint for the system prompt",
  promptGuidelines: ["Use my_tool when ..."],
  parameters: Type.Object({ ... }),
};
```

No logic lives here — this is just the shape the model sees. The matching file in `../tools/` spreads this
object into `pi.registerTool({...})` and adds `execute()`. Keep the two files in sync when a parameter changes.
