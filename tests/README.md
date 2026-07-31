# tests

Run with `npm test` (or a single file: `node --test tests/find.test.ts`). No build step — Node 24 runs the
`.ts` files directly.

Each tool test builds a temp fixture with `fixtures.ts` (`makeFixture`/`cleanupFixture`), calls the tool's
plain async function (e.g. `findFiles`, not the `pi.registerTool` wrapper), and asserts on the returned
result object rather than the rendered text.

`pathSafety.test.ts` covers `resolveSafePath`, including symlink-escape attempts. Those cases create real
symlinks via `fs.symlink` and `t.skip()` when that fails with `EPERM` — expected on Windows without Developer
Mode or admin privileges.
