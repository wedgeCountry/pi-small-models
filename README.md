
# Pi Coding Agent Extensions for usage of weaker models

I realized that some weaker models, such as gemma4-e4b, are struggling with the default implementations of edit and bash.
Also they have problems dealing in windows environments.

The solution I found was to give them very basic tools instead of bash and simplify the edit tool. 

Implemented using the staggering Claude with Claude [claude.ai](https://claude.ai) Code.

## Tools

Registered by `index.ts` via `pi.registerTool`. `find`, `grep`, `edit`, `read`, and `write` share a name with
one of Pi's built-in tools, so registering them here replaces the built-in (same-name registration wins per
Pi's tool registry); `bash` is disabled outright on `session_start`.

| Tool         | Replaces built-in? | What it does |
|--------------|---------------------|--------------|
| `find`       | yes                 | glob-based file search |
| `grep`       | yes                 | pattern search across files; the scan itself runs on a worker thread with a wall-clock timeout, so a catastrophically-backtracking regex can't hang the session |
| `edit`       | yes                 | single `{path, oldText, newText}` replacement per call, instead of a batched edit list |
| `read`       | yes                 | line-numbered file contents, capped at 2000 lines/50KB per call |
| `write`      | yes                 | create/overwrite a file's full contents, sandboxed the same as the rest of these tools |
| `list`       | no                  | directory listing |
| `mkdir`      | no                  | `mkdir -p`-style directory creation |
| `remove`     | no                  | delete a file or directory (`recursive: true` required for directories; refuses to delete the project root) |
| `lstat`      | no                  | file/symlink metadata, never follows symlinks |
| `insert`     | no                  | insert text after a given line without touching the rest of the file |
| `git_status` | no                  | `git status`, parsed into `{branch, ahead, behind, entries}` |
| `git_diff`   | no                  | unstaged `git diff`, optionally scoped to a path, with the same line/byte truncation cap as `read` |

Every tool resolves its `path` argument through `resolveSandboxPath` (`src/sandbox.ts`) first, so the model
can't read or write outside the project root even without `bash`. `git_status`/`git_diff` additionally filter
their parsed output against the same restricted-path list even on their default, unscoped (whole-repository)
call, so a tracked `.env` with an uncommitted change can't leak its path or diff content that way either.

## Sandboxing

`src/sandbox.ts` gates every tool call behind a two-state `/toggle-sandbox` toggle:

- **`on`** (default) — full local enforcement: the model can't escape the project root, and a built-in
  credential/`.git` glob list blocks reads or edits of things like `.env`, `.ssh/`, and `.git/`.
- **`off`** — nothing is enforced locally, not even root containment. In exchange, every call to one of
  this project's tools goes through an explicit approval dialog instead — see below.

### `src/permissionGate.ts`: this project's own approval gate

Rather than depend on a separate permission-managing extension being installed *and* configured, this
project builds its own decision system directly on Pi's `ExtensionAPI`: `pi.on("tool_call", ...)` fires
before any tool executes and can block it, and `ctx.ui.confirm(...)` shows a real yes/no dialog. No other
extension is required.

- **`on`** — the gate does nothing; `sandbox.ts` already fully enforces containment locally, so there's
  nothing left to ask about.
- **`off`** — every call to one of this project's 12 tools is intercepted before it runs and requires an
  explicit approval (one-shot — declining or approving a call isn't remembered for next time). Declining
  blocks the call with a reason the model sees. In a non-interactive context with no dialog available, the
  call is blocked automatically rather than silently let through.

An earlier version of this file tried to cooperate with the separate
[`@gotgenes/pi-permission-system`](https://pi.dev/packages/@gotgenes/pi-permission-system) extension so
that `"on"` could auto-suppress a second prompt from it. That relied on a `registerAuthorizer` hook that
doesn't exist on the package's actual public API, so the integration silently never worked — this file
replaces it with something that does.

## Install in a project

```bash
pi install git:github.com/wedgeCountry/pi-small-models
```

## Development

```bash
npm test           # node --test src/tests/**/*.test.ts
npx tsc --noEmit   # type-check only, no build step
```

See `doc/architecture.md` for a short human-facing overview, `CLAUDE.md` for the full architecture writeup,
and the per-directory `README.md` files under `src/`, `src/tools/`, `src/tool_definitions/`, and
`src/tests/` for the shape of individual tools.