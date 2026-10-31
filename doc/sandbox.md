# Sandbox

## What it is for

Every tool call must stay inside the project root and must never touch protected files
(credentials, `.git/`, `node_modules/`, …). The sandbox enforces this centrally, so tools
never check paths themselves.

## How it is used

- One immutable `Sandbox` per tool call: `sandboxFor(ctx.cwd)` (`src/sandbox/sandbox.ts`).
- Tools ask the sandbox, in three ways:
  - `resolve(path)` — validate a model-given path, return the absolute path (throws `SandboxError`).
  - `entryFilter(dir)` — filter entries found during a directory walk.
  - `allowsReported(rel)` — filter paths reported by external programs (e.g. git).
- Every check runs twice: on the path as given **and** on its symlink-resolved real path.
- `/toggle-sandbox off` disables local checks; instead every tool call asks for explicit
  user confirmation (`src/sandbox/permissionGate.ts`). Reset to `on` at each session start.

## Rules (`src/sandbox/policy.ts`)

- **Containment**: resolved path must stay inside the root (`isInside`).
- **Restricted names**: any path segment that canonicalizes (strip surrounding dots, lowercase)
  to `.git`, `.venv`, `node_modules`, `bower_components`, `jspm_packages` is blocked —
  at any depth, including symlink-resolved paths.
- **Restricted globs**: credential/secret files — `.env*`, `.ssh/**`, `.aws/**`, `id_rsa`,
  `.npmrc`, `server.pem`, … — plus prefix globs (`**/.git*` etc.) so suffixed copies
  (`.git-backup`) are blocked too. See [restricted-paths.md](restricted-paths.md).
- **Syntax rejections** (`sandbox.ts`): `~`, env-var syntax, URL-encoding, control/Unicode
  lookalike characters.
- The user's home directory is rejected as a project root.
