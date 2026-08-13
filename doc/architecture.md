# Architecture

## What this is

A [Pi coding agent](https://pi.dev) extension that disables Pi's built-in `bash`
tool and replaces it with a set of structured, single-purpose filesystem
tools: `find`, `grep`, `list`, `edit`, `mkdir`, `remove`, `lstat`, `insert`,
`write`. The premise: smaller/weaker models do better with constrained,
structured tools than with a raw shell.

No build step — `index.ts` and everything under `src/` run directly via
Node 24's native TypeScript type-stripping, in both the extension and its
tests.

## Tool structure

Each tool is split into two files that must stay in sync:

- `src/tool_definitions/<tool>.ts` — the static `*_TOOL_DEFINITION`: name,
  description, `promptSnippet`/`promptGuidelines` shown to the model, and the
  typebox `parameters` schema.
- `src/tools/<tool>.ts` — spreads the definition into `pi.registerTool({...})`
  and implements `execute()`. Each file also exports a plain async function
  (`findFiles`, `grepFiles`, `listDir`, `editFile`, `makeDir`, `removePath`,
  `lstatPath`, `insertText`, `writeFile`) that does the real work independent
  of the Pi tool wrapper — this is what `src/tests/` exercises directly,
  without going through `ExtensionAPI`.

`grep` additionally has `src/tools/grepWorker.ts` (see below).

`index.ts` registers all nine tools, then on `session_start` filters `bash`
out of the active tool list. `find`/`grep`/`edit`/`write` share names with
Pi's built-ins and replace them automatically via Pi's tool registry;
`list`/`mkdir`/`remove`/`lstat`/`insert` have no built-in name collision.

## Design choices

**Simplified `edit` API.** Pi's built-in `edit` takes a `path` plus an
`edits` array for several disjoint changes in one call. This project's
`edit` takes a single `{path, oldText, newText}` — `oldText` must match
exactly one location or `editFile` throws (`allowMultipleMatches: true`
opts out of the uniqueness check to replace every occurrence instead).
Callers needing multiple changes to one file make multiple calls.

**Guardrails as testable plain functions, not `execute()` checks.** e.g.
`remove` refuses to delete a directory without `recursive: true`, and
refuses to delete the project root — enforced by a `projectRoot` option on
`removePath` itself (`src/tools/remove.ts`), so the guard is exercised by
the same plain-function tests as everything else, and throws before even
`lstat`-ing the target. `execute()` just forwards `projectRoot: ctx.cwd`.

**Consistent capped/truncated results.** `find`, `grep`, and `list` all
return a `{..., total, truncated}` shape and cap output at `maxResults`
(default 200). `truncated` is only set once the scan finds one match/entry
*beyond* the cap, not merely when the running count reaches it — so an
exact-boundary result (e.g. exactly 200 matches with `maxResults: 200`)
isn't incorrectly flagged as truncated.

**Line-ending preservation.** `insert` detects a file's existing line-ending
style (`\r\n` vs `\n`) and reuses it for the spliced-in line, rather than
mixing terminators.

## Concurrency and cancellation

**`grep` runs off the main thread.** A synchronous `RegExp.test()` on a
catastrophically-backtracking pattern (e.g. `(a+)+$`) can't be interrupted
by checking an `AbortSignal` between iterations — the only way out is
killing the thread. `grepFiles()` glob-expands files on the main thread,
then hands `{base, files, pattern, flags, max, context}` to a fresh
`worker_threads.Worker` (`grepWorker.ts`) and races it against a wall-clock
timeout (`DEFAULT_TIMEOUT_MS` = 5000ms, not exposed as a tool parameter).
On timeout or abort, the worker is `terminate()`d and the call rejects; on
success it posts back a `GrepResult` and is terminated normally. A new
worker spins up per call rather than pooling one, since call volume is low
(interactive tool calls, not a hot loop). Worker threads load `.ts`
directly the same way the main process does — no separate build step.

**Cancellation (the `signal` Pi passes into every `execute()`):**
- `edit`, `insert`, and `write`'s final write pass `signal` straight through
  to `fs.readFile`/`fs.writeFile`, which honor `AbortSignal` natively.
- `fs.mkdir` and `fs.rm` do **not** accept a `signal` at all (verified
  empirically). `mkdir`, a non-recursive `remove`, and `write`'s preceding
  `mkdir({recursive: true})` just `throwIfAborted()` once before starting —
  reasonable since none is more than a handful of syscalls.
- A recursive `remove` can walk an arbitrarily large tree, so it doesn't
  delegate to one `fs.rm({recursive: true})` call. `removeRecursively`
  walks entries itself and checks `signal` before each one — the same
  per-step-check pattern `list.ts`'s `walk()` uses.
- `find` has the same problem one level up: fast-glob's promise-returning
  `fg()` can't be interrupted once started, so `find.ts` uses `fg.stream()`
  and `.destroy()`s it on abort, stopping further directory reads.

## Filesystem sandboxing (`src/pathSafety.ts`)

`resolveSafePath(root, target)` resolves a user-supplied path against the
project root and throws if it would escape it. Every tool's `execute()`
calls this before touching the filesystem — the boundary that makes it
safe to expose filesystem tools to the model without bash. Two layers:

1. A lexical `..`-traversal / absolute-path check on
   `path.relative(root, resolved)`.
2. A symlink-aware check: resolves both `root` and the target to their real
   (symlink-followed) paths and re-verifies containment, closing the gap
   where a symlink inside the project root points outside it.

Because targets are often paths that don't exist yet (`mkdir`, or a file
under a not-yet-created directory), the real-path resolution walks up to
the nearest *existing* ancestor, resolves only that with `fs.realpathSync`,
and reattaches the missing suffix lexically. This also means the function
degrades gracefully (no throw) when `root` itself doesn't exist on disk,
letting `src/tests/pathSafety.test.ts` exercise lexical-only cases without
touching the real filesystem.

`resolveSafePath` only validates the one `path` a tool is called with — not
entries a directory walk *discovers* underneath an already-safe base.
`find`/`grep`/`list` glob or `readdir` beneath their (safe) base, and a
symlink in that tree can point outside it even though the base passed
`resolveSafePath`; `fast-glob`'s `followSymbolicLinks: false` only stops
*descending into* a symlinked directory, it doesn't exclude a symlinked
file from the match list. `isEntryWithinBase(base, entryPath)` covers this:
it realpath-resolves `entryPath` and re-checks containment against `base`.
`find.ts`/`grep.ts` request `objectMode: true` from fast-glob (returns
`{name, path, dirent}` for free, no extra `stat()`) and drop any entry
where `dirent.isSymbolicLink()` is true and `isEntryWithinBase` fails.
`list.ts`'s manual `readdir` walk does the same with the `dirent` it
already has, and never recurses into a symlinked directory in the first
place since `Dirent.isDirectory()` is false for a symlink entry. Non-symlink
entries (the overwhelming majority) pay no extra realpath-check cost.

## Shared infrastructure

- **`src/ignore.ts`** — `DEFAULT_IGNORE_GLOBS` (fast-glob patterns, used by
  `find`/`grep`) and `DEFAULT_IGNORE_NAMES` (a `Set` of bare directory names,
  used by `list`'s manual walk) — both cover `node_modules`, `.git`, `dist`,
  `build`, `.pi`.
- **`src/mutationQueue.ts`** — `withFileMutationQueue(filePath, fn)`
  serializes filesystem-mutating operations targeting the same file, keyed
  by its real (symlink-resolved) path (falling back to its plain resolved
  path if it doesn't exist yet). `writeFile`, `editFile`/`editFileMulti`,
  `insertText`, and `removePath` each wrap their whole read-modify-write (or
  lstat-then-delete) in this, so overlapping calls on the same path — two
  edits, a `write` racing an `edit`, an `insert` racing a `remove` — queue
  instead of interleaving; without it, both could read before either
  writes, and the last write would silently discard the other's change (or
  resurrect a file `remove` just deleted). Modeled on Pi's own built-in
  `write`/`edit` tools, which share an equivalent helper — a gap this
  project's `edit`/`insert`/`remove` didn't otherwise have, since they
  bypass the built-ins entirely. Only locks the literal path passed in, not
  a whole subtree — a recursive `remove` doesn't hold an exclusive lock
  over every descendant, only the top-level target.

## Testing pattern

`src/tests/fixtures.ts` provides `makeFixture`/`cleanupFixture` for
creating and tearing down temp directories with a given file tree. Every
tool test builds a fixture, calls the tool's plain async function against
it, and asserts on the returned result object — not the rendered text this
keeps tests decoupled from Pi's `ExtensionAPI` and from output formatting.

`src/tests/pathSafety.test.ts`'s symlink-escape tests create real symlinks
via `fs.symlink` and `t.skip()` on `EPERM` — expected on Windows without
Developer Mode or admin privileges, so those tests report as skipped rather
than failed there.

## Other invariants

- `mkdir` always behaves like `mkdir -p` (creates missing parents, no-ops
  if the directory already exists).
- `lstat` never follows symlinks (`isSymbolicLink` is reported rather than
  resolved through).
- `insert` adds text after a 1-indexed `line` (matching `grep`'s line
  numbers) without touching existing content; `line: 0` inserts before the
  first line, `line` equal to the file's line count appends at the end.
- `write` mirrors Pi's built-in write tool (creates, overwrites wholesale,
  creates missing parent directories first) but goes through
  `resolveSafePath` first, which the built-in does not — so it can't be
  pointed outside the project root.
