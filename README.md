# pi-small-models

Simpler tools for small models in the [Pi coding agent](https://pi.dev).

Small local models such as `gemma4-e4b` often struggle with Pi's default `bash` and `edit` tools, and
with Windows shells in particular. This extension takes `bash` away and gives the model a set of small,
single-purpose tools instead: read a file, edit one spot, list a folder, check git status, and so on.
Each tool does one thing, takes a few simple arguments and returns a short, predictable answer, which
weaker models handle much more reliably than a raw shell.

Built with [Claude Code](https://claude.ai).

## Install

You need [Pi](https://pi.dev) installed. Then, from your project:

```bash
# Install from npm (recommended)
pi install npm:pi-small-models

# Or install from git
pi install git:github.com/wedgeCountry/pi-small-models
```

Start Pi as usual. The `bash` tool is gone, and the tools below are available to the model.

## What the model gets

**Files and folders**

| Tool     | What it does |
|----------|--------------|
| `read`   | Show a file with line numbers (up to 2000 lines per call) |
| `write`  | Create a file or replace its whole contents |
| `edit`   | Replace one piece of text in a file |
| `insert` | Insert text after a given line |
| `list`   | List a folder |
| `mkdir`  | Create a folder (and any missing parents) |
| `copy`   | Copy a file or folder |
| `move`   | Move or rename a file or folder |
| `remove` | Delete a file or folder |
| `lstat`  | Show file details (size, type, dates) |

**Searching**

| Tool          | What it does |
|---------------|--------------|
| `find`        | Find files by glob pattern |
| `grep`        | Search file contents |
| `find_usages` | Find where a class or function is used (Python, TypeScript/JavaScript, C#) |

**Git** (read-only)

| Tool         | What it does |
|--------------|--------------|
| `git_status` | Current branch and changed files |
| `git_diff`   | Unstaged changes, optionally for one path |
| `git_log`    | Recent commits with author, date and changed files |

`read`, `write`, `edit`, `find` and `grep` replace Pi's built-in tools of the same name.

## Safety: the sandbox

By default the model is kept inside your project folder. It can't read or change anything outside it,
and it can't touch sensitive files such as `.env`, `.ssh/` or the `.git/` folder.

If you need the model to go beyond that, type `/toggle-sandbox` in Pi to switch the sandbox off. Pi
will then ask you to approve **every** tool call before it runs. Type `/toggle-sandbox` again to switch
it back on. Every new session starts with the sandbox on.

## Hiding files from the model

`find`, `grep` and `list` already skip folders like `node_modules`, `.git`, `dist`, `build`, `bin` and
`obj`. To hide more:

- **For one project:** add glob patterns, one per line, to a `.piignore` file in the project root.
- **For all projects:** type `/ignore <pattern>` in Pi. Type `/ignore` on its own to see what is
  currently ignored.

### Where to look next

- [`doc/architecture.md`](doc/architecture.md) — how the project is put together
- [`doc/tool-pattern.md`](doc/tool-pattern.md) — how to add a new tool
- `README.md` files in `src/`, `src/tools/`, `src/tool_definitions/` and `tests/`

## Security

See [SECURITY.md](SECURITY.md) for details on the sandbox model and known vulnerabilities.

## License

See [LICENSE](LICENSE).
