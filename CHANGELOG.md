# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `git_diff` takes an optional `nameOnly` (git's `--name-only`): one line per changed path, no diff
  body. A cheap "what changed?" step for a small model to decide which files are worth a full diff.
  `--name-only` implies `--no-patch`, so no other flag is needed, and `path` scoping works the same
  in both modes.
- `git_diff` name-only output gets its own protected-path filter (`filterRestrictedNameOnly`): the
  chunk filter relies on `diff --git a/… b/…` headers to split a diff into per-file sections, and
  name-only output has no headers at all, so paths are dropped line by line instead. A tracked
  `.env` stays invisible in both modes.
- `GitDiffResult.noHead` — true when the repository has no commit yet — surfaced to the model as
  "The repository has no commit yet, so there is nothing to diff against.", distinct from the
  "No changes." answer an empty diff gets.
- Tool-call line shows the flag (`git_diff --name-only src/…`), and the truncation hint says
  "File list truncated" rather than "Diff truncated" in name-only mode.

### Fixed
- `list` wraps unexpected walk errors (e.g. a missing directory) in the unified `toolError` shape
  instead of letting a raw fs error (with its absolute host path) reach the model.
- `Sandbox.resolve`'s realpath fallback treats `ENOTDIR` like `ENOENT` (walking up to the nearest
  existing ancestor), so a path whose parent is a regular file no longer throws a raw fs error
  from inside the sandbox; the calling tool's own formatted error is reported instead.

### Changed
- All tools now build their `execute()` return value through one factory, `toolOutput(details, text)`
  (`src/backend/toolOutput.ts`): the structured `{ content: [{ type: "text", text }], details }`
  shape — and the triple-backtick escaping of `text` — come from a single place instead of being
  repeated per tool. `details` passes through untouched for the UI and programmatic callers.
- Every tool now escapes triple backticks in its returned text (`src/backend/escapeBackticks.ts`):
  a file, path, diff or commit message containing ``` can no longer break into (or out of) a
  markdown code block in the model's transcript. Backtick runs of three or more are split with
  zero-width joiners, so the text still reads as backticks.
- `git_diff` now runs `git diff HEAD` instead of plain `git diff`, so staged changes are reported
  too instead of being invisible until they're committed.
- `git diff`'s `bad revision 'HEAD'` failure in a repository without commits is caught and reported
  as `noHead` rather than thrown as `git diff failed: …`.
- Both `git_diff` filters now judge a git-reported path in two forms: as printed and with git's
  core.quotepath quoting stripped (`reportedPathAllowed` / `unquoteGitPath`), so a protected file
  whose name git escapes (`".env\303\251"`) no longer slips past the `**/.env*` pattern. Stripping
  quotes can only ever make a path more likely to be rejected, never less.

### Tests
- `tests/structured_result.test.ts`: a parameterized test that every tool's `execute()` returns
  Pi's structured tool-result shape (`content` array of `{ type: "text" }` blocks with string
  `text`, plus an object `details`) and that failures throw tool-formatted errors — what the
  framework turns into the `{ role: "toolResult", toolName, content, isError }` message.
- `tests/escape_backticks.test.ts`: a parameterized test that runs every registered tool's
  `execute()` against fixture content containing triple backticks (file contents, filenames,
  commit messages) and asserts no literal ``` survives in the returned text.
- `tests/git_diff.test.ts`: `nameOnly` lists changed paths with no diff body; covers staged and
  unstaged changes against HEAD as one entry per file; is scoped by `path`; reports nothing for a
  clean repo; omits sandbox-restricted paths; omits a restricted path git C-quotes (checked in both
  name-only and diff-body mode); and the no-commits-yet case. Not run yet — `bash` is disabled in
  this project, so verify with `npm test`.

### Known limitations
- Name-only mode names only the post-image side of a rename, so a rename *out of* a protected path
  shows its new, unrestricted name and there is no old-path header to check it against. No contents
  are disclosed with it, and that path is one the model may read anyway; `git_status`, which reports
  both ends of a rename, is the tool that has to hold the stronger claim.
- `git_log` and `git_status` still call `sb.allowsReported` on git's quoted output directly, so they
  keep the core.quotepath blind spot this release fixes for `git_diff`. Moving `reportedPathAllowed`
  into a shared helper and applying it there is an open follow-up.
- Path relativity is unchanged: without git's `--relative`, `git_diff` prints paths relative to the
  repository top level while `git_status` prints them relative to the working directory, so the two
  disagree about what a path means when the sandbox root is a subdirectory of the repo (finding M1).
  Filtering still holds — every pattern in `RESTRICTED_GLOBS` is `**`-anchored, and the `-- <scope>`
  pathspec keeps changes outside the root out of the output — but a model that copies such a path
  back into another tool gets the wrong answer. Adding `--relative` to `git_diff` and `git_log`'s
  `--name-only` calls together is the candidate fix.

## [0.1.0] - 2026-10-19

### Added
- Initial release of pi-small-models extension
- Structured filesystem tools: read, write, edit, insert, list, mkdir, copy, move, remove, lstat
- Search tools: find, grep, find_usages
- Git tools (read-only): git_status, git_diff, git_log
- Sandbox system with path traversal protection and restricted file access
- .piignore support for hiding files from the model
- /toggle-sandbox command to enable/disable sandbox
- /ignore command to manage global and local ignore patterns

### Security
- Sandbox blocks access to sensitive files (.env, .ssh/, .git/, etc.)
- Path traversal attempts are blocked
- All inputs validated before filesystem operations
- See SECURITY.md for details
