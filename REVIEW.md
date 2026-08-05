# Critical Review — `pi-small-models`

_Reviewed 2026-08-05. Based on reading every tool implementation, both path-safety layers, the
worker-thread grep implementation, and the test suite; verified against a full `npm test` run and
two targeted proof-of-concept scripts._

The project is a small, well-documented extension (CLAUDE.md, a README per directory, 50 passing
tests) and the design is generally careful. But the central design claim — "resolveSafePath means
the model can't read or write outside the project root even without bash" (README.md:26-27) —
doesn't fully hold, and there are a few other real gaps.

## 1. Symlink escape in `grep`/`find`/`list` (High)

`resolveSafePath` (`src/pathSafety.ts`) does the right thing when a tool's `path` parameter *is*
the target — it realpath-resolves and re-checks containment, which is exactly what catches a
symlink pointing outside root (proven by the existing `pathSafety.test.ts` symlink tests).

But `grep`, `find`, and `list` only call `resolveSafePath` once, on the **base directory**
(`src/tools/grep.ts:126`, `find.ts:36`, `list.ts:60`). Everything discovered *beneath* that base —
via `fast-glob` or `fs.readdir` — is trusted without a second check. `fast-glob`'s
`followSymbolicLinks: false` (set in both `grep.ts` and `find.ts`) only suppresses descending into
symlinked *directories* during `**` expansion; per fast-glob's own docs it does nothing to exclude
a symlinked *file* from the match list. `grepWorker.ts:44` then does a plain `fs.readFile`, which
dereferences symlinks by default.

Net effect: a symlink committed inside the project (e.g. `link.txt -> ../../secrets.env` or
`-> /etc/passwd`) is invisible to the base-directory check, gets enumerated by `fast-glob`, and its
**contents** get read and returned to the model by `grep`. `find`/`list` have the milder version of
the same gap — they disclose the symlink's path/name (not content) since they don't read file
bodies.

I couldn't run the live exploit in this session — creating a symlink required elevated privileges
here, the same `EPERM` the project's own `pathSafety.test.ts` already skips around on Windows — but
on any POSIX host (or Windows with dev mode) this reproduces directly from the code path, and I
confirmed the fast-glob behavior against its shipped README (`followSymbolicLinks` §: "this option
does not affect the base directory of the pattern" / traversal-only semantics).

**Fix direction**: after `fast-glob`/`readdir` returns matches, `lstat` each one and reject (or
skip) any whose realpath escapes `base` — the same check `resolveSafePath` already does, applied
per-entry instead of once at the top.

## 2. No cancellation for most tools (Medium)

Only `grep` (via its worker-thread wall-clock timeout) and `list` (via an `AbortSignal` check
between directory reads) can actually be interrupted. `find`'s `fast-glob` call gets no `signal` at
all, and `remove`'s recursive `fs.rm`, `edit`, `insert`, `mkdir` never wire the `signal` parameter
Pi hands to `execute()` into the underlying `fs` calls (Node's `fs/promises` APIs accept a `signal`
option that's simply unused here). A weak model issuing `find` over an enormous unfiltered tree, or
a runaway `remove --recursive` on a large directory, runs to completion with no way to stop it —
which cuts against the project's stated goal of giving weaker models *tighter*, safer control than
raw bash.

## 3. `edit` with an empty `oldText` corrupts the file (Medium)

Verified directly:

```
editFile(file, "", "X")                         → "oldText is not unique" (always, for any file)
editFile(file, "", "X", {allowMultipleMatches})  → "abc" becomes "aXbXc"
```

`content.indexOf("")` always returns a valid index, so an empty `oldText` is unconditionally
treated as "matches everywhere." Nothing in the typebox schema (`tool_definitions/edit.ts`)
enforces `minLength: 1` on `oldText`, so a model that (plausibly, given it's a weaker model) passes
an empty string to widen a match gets silent character-by-character corruption instead of a clear
rejection.

## 4. Safety guarantees are untested at the layer that matters (Medium)

Every test file (per CLAUDE.md's own description, confirmed by reading them) exercises the plain
functions (`removePath`, `findFiles`, …), never the `pi.registerTool` `execute()` wrappers. That
means:

- The project-root delete guard (`src/tools/remove.ts:32-34`) — arguably the single most
  safety-critical line in the repo — has zero test coverage.
- `resolveSafePath` actually being invoked with `ctx.cwd` on every tool, and the text/truncation
  formatting in each `execute()`, are also unverified.

A refactor that accidentally dropped the root-guard check would pass `npm test` cleanly.

## Minor

- **`.mcp.json`** commits a machine-local WebStorm MCP proxy (`http://127.0.0.1:64542/stream`) at
  the repo root. `.idea` is gitignored for exactly this reason; this should probably join it rather
  than being checked in as shared config.
- **`list`'s `maxDepth`** is silently discarded (forced to `0`) whenever `recursive` is false, with
  no error or note in the parameter description — a model can pass
  `{recursive: false, maxDepth: 5}` and get no explanation for why depth had no effect.

## What's solid

`pathSafety.ts`'s realpath-aware containment check (when it *is* applied) is genuinely careful —
the missing-ancestor handling for not-yet-created paths is a nice touch and well tested. The grep
worker-thread/timeout design for catastrophic backtracking is the right tool for a problem
`AbortSignal` genuinely can't solve. Documentation (CLAUDE.md + per-directory READMEs) is unusually
precise about intent, which made this review fast to do accurately.

**Priority fix**: #1 — it's the one place where the documented security model and the actual code
diverge.
