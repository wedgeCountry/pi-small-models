
# Pi Coding Agent Extensions for usage of weaker models

I realized that some weaker models, such as gemma4-e4b, are struggling with the default implementations of edit and bash.
Also they have problems dealing in windows environments.

The solution I found was to give them very basic tools instead of bash and simplify the edit tool. 

Implemented using the staggering Claude with Claude [claude.ai](https://claude.ai) Code.

## Tools

Registered by `index.ts` via `pi.registerTool`. `find`, `grep`, `edit`, and `write` share a name with one of
Pi's built-in tools, so registering them here replaces the built-in (same-name registration wins per Pi's
tool registry); `bash` is disabled outright on `session_start`.

| Tool     | Replaces built-in? | What it does |
|----------|---------------------|--------------|
| `find`   | yes                 | glob-based file search |
| `grep`   | yes                 | pattern search across files, with a timeout so a catastrophic regex can't hang the session |
| `edit`   | yes                 | single `{path, oldText, newText}` replacement per call, instead of a batched edit list |
| `write`  | yes                 | create/overwrite a file's full contents, sandboxed the same as the rest of these tools |
| `list`   | no                  | directory listing |
| `mkdir`  | no                  | `mkdir -p`-style directory creation |
| `remove` | no                  | delete a file or directory (`recursive: true` required for directories) |
| `lstat`  | no                  | file/symlink metadata, never follows symlinks |
| `insert` | no                  | insert text after a given line without touching the rest of the file |

Every tool resolves its `path` argument through `resolveSandboxPath` (`src/sandbox.ts`) first, so the model
can't read or write outside the project root even without `bash`.

## Sandboxing

`src/sandbox.ts` gates every tool call behind a two-state `/toggle-sandbox` toggle:

- **`on`** (default) — full local enforcement: the model can't escape the project root, and a built-in
  credential/`.git` glob list blocks reads or edits of things like `.env`, `.ssh/`, and `.git/`.
- **`off`** — nothing is enforced locally, not even root containment. This is deliberately as open as
  running the built-in `bash` tool would be; see below for what's meant to fill that gap.

### Optional integration with `@gotgenes/pi-permission-system`

This project can cooperate with [`@gotgenes/pi-permission-system`](https://pi.dev/packages/@gotgenes/pi-permission-system),
a separate Pi extension that adds its own, user-configurable `allow`/`deny`/`ask` policy across tool, bash,
path, and MCP/skill access. It is **not a dependency** of this project — `src/permissionAuthorizer.ts`
resolves it dynamically at runtime and no-ops cleanly if it isn't installed, so nothing here requires it.

When it *is* installed, the two sandbox states line up with it like this:

- **`on`** — this project's own sandbox already fully covers anything it would let through inside the
  project root, so a second "may I touch this path?" prompt from permission-system for the same territory
  would just be redundant. `permissionAuthorizer.ts` registers an authorizer (named
  `pi-small-models-sandbox`) that auto-allows a path-shaped request only when this sandbox's own
  containment-*and*-restricted-glob check would already allow it — a credential path like `.ssh/id_rsa` is
  still left to permission-system's own `ask`/`deny`, even though it's inside the project root, since this
  sandbox blocks it too.
- **`off`** — the authorizer declines every request, so enforcement is fully delegated to
  permission-system's own configured policy (including any `ask` rules) instead.

The authorizer only takes effect once it's *also* named in permission-system's own config — registering it
here is opt-in on their side by design (see their docs on `registerAuthorizer`/authorizer chains). Add
`pi-small-models-sandbox` to that config's authorizer list per `@gotgenes/pi-permission-system`'s own
configuration docs to enable it.

## Install in a project

```bash
pi install git:github.com/wedgeCountry/pi-small-models
```

## Development

```bash
npm test          # node --test tests/**/*.test.ts
npx tsc --noEmit   # type-check only, no build step
```

See `CLAUDE.md` for the full architecture writeup, and the per-directory `README.md` files under `src/` and
`src/tests/` for the shape of individual tools.