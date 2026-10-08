# tests

Run with `npm test` (or a single file: `node --test src/tests/find.test.ts`). No build step — Node 24 runs the
`.ts` files directly.

Each tool test builds a temp fixture with `fixtures.ts` (`makeFixture`/`cleanupFixture`), calls the tool's
plain async function (e.g. `findFiles`, not the `pi.registerTool` wrapper), and asserts on the returned
result object rather than the rendered text.

`pathSafety.test.ts` covers `resolveSafePath`, the underlying containment primitive, including symlink-escape
attempts. `sandbox.test.ts` covers `resolveSandboxPath`/`isEntrySandboxSafe` — the mode-aware, toggleable layer
every tool actually calls — including its own symlink-escape and restricted-glob cases. Both files' symlink
cases create real symlinks via `fs.symlink` and `t.skip()` when that fails with `EPERM` — expected on Windows
without Developer Mode or admin privileges.

`peek.test.ts` covers `peekFile` itself (extension dispatch, defaults, errors, truncation, rendering);
`peek_python.test.ts`, `peek_typescript.test.ts`, `peek_csharp.test.ts` and `peek_markdown.test.ts` call each
PreviewManager's `preview()` directly on inline sources and assert the exact outline lines.
