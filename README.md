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
pi install git:github.com/wedgeCountry/pi-small-models
```

Start Pi as usual. The `bash` tool is gone, and the tools below are available to the model.

## What the model gets

**Files and folders**

| Tool     | What it does |
|----------|--------------|
| `read`   | Show a file with line numbers (up to 2000 lines per call) |
| `peek`   | Show just the outline of a file: classes and function signatures, or the headings of a Markdown file |
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
| `search`      | Find files by name, with simpler defaults than `find` |
| `grep`        | Search file contents |
| `find_usages` | Find where a class or function is used (Python, TypeScript/JavaScript, C#) |

**Git** (read-only)

| Tool         | What it does |
|--------------|--------------|
| `git_status` | Current branch and changed files |
| `git_diff`   | Unstaged changes, optionally for one path |
| `git_log`    | Recent commits with author, date and changed files |

**Build and dependencies**

| Tool           | What it does |
|----------------|--------------|
| `ts_check`     | Type-check a TypeScript project (`tsc --noEmit`) |
| `npm_list`     | List installed npm packages |
| `dotnet_build` | Build a .NET project or solution |
| `dotnet_list`  | List NuGet packages, optionally outdated ones |

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

## Working on this project

### 1. Set up Node.js

The project needs **Node.js 24** or newer. Check what you have:

```bash
node --version
```

If that prints an older version, or nothing, install Node 24 with a version manager so you can switch
versions per project.

**Linux and macOS** — with [nvm](https://github.com/nvm-sh/nvm):

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
# open a new terminal, then:
nvm install 24
nvm use 24
# inside the project:
npm install
npm test
```

**Windows** — with [fnm](https://github.com/Schniz/fnm) (in PowerShell):

```powershell
winget install Schniz.fnm
fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression
fnm install 24
fnm use 24
# inside the project:
fnm install
fnm test
```

To make fnm load in every new PowerShell window, add the `fnm env ...` line to your PowerShell profile
(`notepad $PROFILE`).

If you'd rather not use a version manager, the installer from [nodejs.org](https://nodejs.org) works
too — pick the 24.x LTS version.

### 2. Install dependencies

```bash
git clone https://github.com/wedgeCountry/pi-small-models.git
cd pi-small-models
npm install
```

There is no build step: Pi runs the TypeScript source directly.

### 3. Run the tests and type check

```bash
npm test           # all tests
npx tsc --noEmit   # type check
```

To run a single test file:

```bash
npx tsx --test tests/grep.test.ts
```

Some tests create symlinks. On Windows these are skipped unless Developer Mode is on or you run as
administrator; that's expected.

### Where to look next

- [`doc/architecture.md`](doc/architecture.md) — how the project is put together
- [`doc/tool-pattern.md`](doc/tool-pattern.md) — how to add a new tool
- `README.md` files in `src/`, `src/tools/`, `src/tool_definitions/` and `tests/`

## License

See [LICENSE](LICENSE).
