# TODO

Open points from `REVIEW.md` (2026-08-05), ordered by priority.

- [x] **Symlink escape in `grep`/`find`/`list` (High)** — Fixed. Added `isEntryWithinBase(base,
      entryPath)` to `src/pathSafety.ts` (realpath-resolves `entryPath` and re-checks containment
      against `base`, mirroring `resolveSafePath`'s own real-path check). `find.ts`/`grep.ts` now
      request `objectMode: true` from `fast-glob` (free — no extra `stat()` call) and filter out any
      entry where `dirent.isSymbolicLink()` is true and `isEntryWithinBase` fails before the match
      list is returned or handed to the grep worker. `list.ts`'s manual walk does the same using the
      `dirent` it already has from `fs.readdir(..., {withFileTypes: true})`. Non-symlink entries pay
      no extra cost. Added symlink-escape tests to `find.test.ts`/`grep.test.ts`/`list.test.ts`
      (same fixture pattern as `pathSafety.test.ts`, `t.skip()` on `EPERM`).

- [ ] **No cancellation for most tools (Medium)** — only `grep` (timeout) and `list` (`AbortSignal`
      check) can be interrupted. `find` never receives a `signal`; `remove`, `edit`, `insert`,
      `mkdir` never wire the `signal` Pi passes into `execute()` through to the underlying `fs`
      calls. Wire `signal` through (or add a timeout) at least for `find` and `remove --recursive`.

- [ ] **Empty `oldText` in `edit` corrupts the file (Medium)** — `content.indexOf("")` always
      matches, so empty `oldText` is always "not unique" without `allowMultipleMatches`, and with
      `allowMultipleMatches: true` it splices `newText` between every character. Add
      `minLength: 1` to `oldText` in `src/tool_definitions/edit.ts` (or reject empty `oldText`
      explicitly in `editFile`).

- [ ] **Safety guarantees untested at the `execute()` layer (Medium)** — tests only cover the plain
      functions, never the `pi.registerTool` wrappers. The project-root delete guard
      (`src/tools/remove.ts:32-34`) has zero test coverage. Add tests that go through
      `registerRemoveTool`/`execute()` (or extract the guard into a testable helper).

- [ ] **`.mcp.json` commits machine-local config (Minor)** — WebStorm MCP proxy URL
      (`http://127.0.0.1:64542/stream`) at repo root; should likely be gitignored alongside `.idea`.

- [ ] **`list`'s `maxDepth` silently ignored when `recursive` is false (Minor)** — no error or note
      when both are passed together; either document it in the parameter description or reject the
      combination.
