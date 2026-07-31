
# Pi Coding Agent Extensions for usage of weaker models

I realized that some weaker models, such as gemma4-e4b, are struggling with the default implementations of edit and bash.
Also they have problems dealing in windows environments.

The solution I found was to give them very basic tools instead of bash and simplify the edit tool.

## Tools

Registered by `index.ts` via `pi.registerTool`. `find`, `grep`, and `edit` share a name with one of Pi's
built-in tools, so registering them here replaces the built-in (same-name registration wins per Pi's tool
registry); `bash` is disabled outright on `session_start`.

| Tool     | Replaces built-in? | What it does |
|----------|---------------------|--------------|
| `find`   | yes                 | glob-based file search |
| `grep`   | yes                 | pattern search across files, with a timeout so a catastrophic regex can't hang the session |
| `edit`   | yes                 | single `{path, oldText, newText}` replacement per call, instead of a batched edit list |
| `list`   | no                  | directory listing |
| `mkdir`  | no                  | `mkdir -p`-style directory creation |
| `remove` | no                  | delete a file or directory (`recursive: true` required for directories) |
| `lstat`  | no                  | file/symlink metadata, never follows symlinks |
| `insert` | no                  | insert text after a given line without touching the rest of the file |

Every tool resolves its `path` argument through `resolveSafePath` (`src/pathSafety.ts`) first, so the model
can't read or write outside the project root even without `bash`.

## Try it without installing

```bash
pi -e ./index.ts
```

## Install in a project

```json
{
  "extensions": ["/path/to/pi-small-models/index.ts"]
}
```

## Development

```bash
npm test          # node --test tests/**/*.test.ts
npx tsc --noEmit   # type-check only, no build step
```

See `CLAUDE.md` for the full architecture writeup, and the per-directory `README.md` files under `src/` and
`tests/` for the shape of individual tools.