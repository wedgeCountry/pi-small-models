# tests

Run with `npm test` (or a single file: `node --test src/tests/find.test.ts`). No build step — Node 24 runs the
`.ts` files directly.

Each tool test builds a temp fixture with `fixtures.ts` (`makeFixture`/`cleanupFixture`), calls the tool's
plain async function (e.g. `findFiles`, not the `pi.registerTool` wrapper), and asserts on the returned
result object rather than the rendered text.

Tool functions take a `Sandbox` first: tests pass `new Sandbox(dir)` for the enforced case and
`new Sandbox(dir, false)` for the unenforced one, so no test touches the global on/off switch except those
testing the switch itself.

`sandbox.test.ts` is the behaviour spec of the sandbox (rows B1–B8: switch, root containment, protected paths,
walk entries, paths reported by git, unenforced mode, error messages, installed-package locations), including
symlink escapes and disguised symlinks. Its symlink cases create real symlinks via `fs.symlink` and `t.skip()`
when that fails — expected on Windows without Developer Mode or admin privileges. `permissionGate.test.ts`
covers the confirmation gate and the gated registry; `index.test.ts` loads the extension against a fake Pi and
checks that every registered tool is gated and that `/toggle-sandbox` and `session_start` drive the switch.

`peek.test.ts` covers `peekFile` itself (extension dispatch, defaults, errors, truncation, rendering);
`peek_python.test.ts`, `peek_typescript.test.ts`, `peek_csharp.test.ts` and `peek_markdown.test.ts` call each
PreviewManager's `preview()` directly on inline sources and assert the exact outline lines.
