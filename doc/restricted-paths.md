# Restricted paths: how the denylist works and why

`src/sandbox/policy.ts` decides which paths the sandbox refuses to read or write. A path is
restricted if it matches either of two layers:

## Layer 1 — exact directory names (`RESTRICTED_DIR_NAMES`)

`.git`, `.venv`, `node_modules`, `bower_components`, `jspm_packages` are checked **per path
segment**: every `/`-separated segment of the root-relative path is canonicalized (leading and
trailing dots stripped, lowercased) and compared against the list. This covers lookalikes by
construction rather than by enumeration:

| Input segment | Canonical | Blocked? |
|---|---|---|
| `.git`, `.GIT`, `..git`, `.git...` | `git` | yes |
| `node_modules.`, `..NODE_MODULES` | `node_modules` | yes |
| `mygit`, `github` | `mygit`, `github` | no (different name) |

Because every segment is checked, the protection applies at any depth (`a/b/.git/config`) and
on the symlink-resolved real path as well — `sandbox.ts` runs `isRestricted` on both the lexical
and the realpath-resolved form of every path.

## Layer 2 — prefix globs (`RESTRICTED_GLOBS`)

The semantic credential-file globs (`.env*`, `.ssh/**`, `id_rsa`, …) plus five prefix globs:

```
**/.git*  **/.venv*  **/node_modules*  **/bower_components*  **/jspm_packages*
```

## Decision: why the prefix globs exist (restoring old behavior)

An earlier refactor (PR #12) replaced ~35 enumerated lookalike globs with the segment check
alone. That made the rule exact and simple, but it silently stopped blocking **suffixed
variants** such as `.git-backup`, `.git_old`, `.git.bak`, or `node_modules_backup` — breaking
tests `COMPREHENSIVE-16` and `NEW-PATH-VAR-12`. Those names are ordinary, legitimate user files
on Linux, macOS and Windows (backup/rename conventions), so blocking them is a conservative
choice, not an obvious one. The five prefix globs restore the previous behavior at the cost of
five lines, keeping the two layers independent:

- Layer 1 blocks any *spelling* of the protected name (dots, case) — closed by construction.
- Layer 2 blocks any name that *starts with* a protected name — a deliberate over-approximation.

### Known side effect

`**/.git*` also matches `.github`, so `.github/workflows/` is unreadable inside the sandbox.
This was true before the refactor as well; it is accepted as part of the conservative
over-approximation. If it ever becomes a problem, the fix is to replace the prefix globs with a
canonical-segment `startsWith` check that requires a following separator (blocking `git-`,
`git_`, `git.` but not `github`).
