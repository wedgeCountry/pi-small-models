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

- [x] **No cancellation for most tools (Medium)** — Fixed. `find` now scans via fast-glob's
      `stream()` API instead of the un-cancellable promise API, so `signal` abort actually
      `.destroy()`s the underlying stream mid-scan. `remove --recursive` no longer delegates to a
      single `fs.rm({recursive: true})` call — it walks entries itself (`removeRecursively` in
      `src/tools/remove.ts`), checking `signal` before each one, since `fs.rm`/`fs.mkdir` don't
      accept a `signal` option at all (verified empirically; only `fs.readFile`/`writeFile` honor
      it natively). `edit` and `insert` pass `signal` straight through to their `readFile`/
      `writeFile` calls. `mkdir` and non-recursive `remove` at least `throwIfAborted()` before
      starting, since there's nothing longer-running to interrupt mid-flight there. Added
      already-aborted and in-flight-abort tests to `find`/`remove`/`edit`/`insert`/`mkdir` test
      files.

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
