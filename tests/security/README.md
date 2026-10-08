# Security / penetration tests

Failing test cases that demonstrate the findings from the security & architecture review. **These
are deliberately red** — each one asserts the *secure* behaviour, so it fails against the current
code and will go green only once the behaviour is fixed. Nothing here changes production code.

Run just these:

```bash
npx tsx --test tests/security/*.test.ts
```

As of the last run: 42 fail, 4 skipped (documented), 0 unexpected passes. Some tests skip
gracefully when a toolchain (python3, git, npm, dotnet) or platform (Windows) is unavailable, the
same way the existing dotnet/symlink tests do. Payloads are benign — the "exploit" tests only
`touch` a marker file inside the test's own temp directory to prove code ran.

| File | Findings | What it proves (secure expectation that currently fails) |
|------|----------|-----------------------------------------------------------|
| `sec_c1_python_exec.test.ts` | C1 | A `.pth` file, and a replaced `.venv/bin/python3`, planted with `write`/`copy` must not execute when `py_list`/`py_lib` run |
| `sec_c2_ts_check_exec.test.ts` | C2 | `ts_check` must not run a model-writable `node_modules/.bin/tsc` |
| `sec_c3_option_injection.test.ts` | C3 | `Sandbox.relative()` must not return an option-shaped (`-…`) scope path |
| `sec_h1_agent_config.test.ts` | H1 | `.pi/**`, `.agents/**`, `AGENTS.md`, `CLAUDE.md`, `.piignore` must not be writable |
| `sec_h2_copy_move_bypass.test.ts` | H2 | Copying/moving a parent dir, or recursively removing one, must not expose/relocate/delete a protected file |
| `sec_h3_denylist_gaps.test.ts` | H3 | Common credential files must be restricted; `$HOME` as root must be refused |
| `sec_h4_gitdiff_failopen.test.ts` | H4 | `git_diff` must hide a tracked `.env` even under `diff.mnemonicPrefix=true` |
| `sec_h5_grep_broken.test.ts` | H5 | `grep`'s schema must declare `pattern`; a scan > 1 s must not fail as a startup timeout |
| `sec_m1_git_subdir.test.ts` | M1 | `git_diff` rooted at a subdirectory must not reveal changes outside it |
| `sec_m2_lib_roots.test.ts` | M2 | `py_lib` must not read source pulled in by a model-written `sys.path` (`.pth`) entry |
| `sec_m3_permission_gate.test.ts` | M3 | The approval dialog must describe mutations/executions; executing tools must be gated with the sandbox on |
| `sec_m4_resource_limits.test.ts` | M4 | `find` must reject absolute globs; `list` must clamp depth; a slow child must time out |
| `sec_m6_output_caps.test.ts` | M6 | `read` must cap a single very long line at the byte limit |
| `sec_misc_defects.test.ts` | L9, D3 | `dotnet_build` must honour an already-aborted signal; `find_usages` auto must handle multi-language repos |
| `sec_platform.test.ts` | L2, M5 | `npm_list` must not let a `-`-prefixed package become an option; must start on Windows (skips off-Windows) |
| `sec_correctness.test.ts` | D1, D2, D5 | `search` must honour custom ignores; `git_log` default should be 10; `find` must see non-protected dotfiles |
| `sec_low_hardening.test.ts` | L3 (+L1/L4/L6 documented skips) | Read errors must not echo absolute host paths; three hardening items left as reviewer placeholders |

Finding IDs match the review document. `D*` are the correctness defects listed there.
