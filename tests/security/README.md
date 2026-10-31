# Security Tests

Penetration tests demonstrating security findings. **These tests are intentionally failing** — each asserts the secure behavior that should prevent the vulnerability.

## Running
```bash
npx tsx --test tests/security/*.test.ts
```

## Current Status
- 21 test files, 126 individual tests, all failing (expected — they document unfixed vulnerabilities)
- 7 `t.skip(...)` calls for scenarios that need a specific platform or toolchain (git, POSIX `sleep`, symlink creation, dotnet)
- 0 unexpected passes

## Test Coverage
| Test File | Finding | Secure Behavior Being Tested |
|-----------|---------|------------------------------|
| `sec_c3_option_injection.test.ts` | C3 | `Sandbox.relative()` must not return option-shaped paths |
| `sec_h1_agent_config.test.ts` | H1 | Config files (`.pi/`, `.agents/`, `AGENTS.md`) must not be writable |
| `sec_h2_copy_move_bypass.test.ts` | H2 | Copy/move/remove operations must not expose protected files |
| `sec_h3_denylist_gaps.test.ts` | H3 | Credential files restricted; `$HOME` as root refused |
| `sec_h4_gitdiff_failopen.test.ts` | H4 | `git_diff` must hide tracked `.env` files |
| `sec_h5_grep_broken.test.ts` | H5 | `grep` schema validates `pattern`; long scans must not timeout |
| `sec_h6_tilde_escape.test.ts` | H6 | Tilde (`~`) expansion must not escape the sandbox root |
| `sec_h7_path_traversal_bypass.test.ts` | H7 | Path traversal and bypass variants must be blocked |
| `sec_low_hardening.test.ts` | L1–L6 | Error messages don't echo absolute paths; size caps; dotfile handling |
| `sec_m1_git_subdir.test.ts` | M1 | `git_diff` scoped to subdirectory must not leak parent changes |
| `sec_m3_permission_gate.test.ts` | M3 | Approval dialog describes mutations; tools gated with sandbox on |
| `sec_m4_resource_limits.test.ts` | M4 | `find` rejects absolute globs; `list` clamps depth; slow children timeout |
| `sec_m6_output_caps.test.ts` | M6 | `read` caps very long lines at byte limit |
| `sec_misc_defects.test.ts` | L9, D3 | `find_usages` handles multi-language repos |
| `sec_correctness.test.ts` | D1, D2, D5 | Default values and dotfile handling |
| `sec_new_case_sensitivity_bypass.test.ts` | NEW-CASE | Case-sensitivity bypass on Linux must be blocked |
| `sec_new_comprehensive_bypass.test.ts` | NEW-COMPREHENSIVE (COMPREHENSIVE-16) | Comprehensive bypass battery |
| `sec_new_node_modules_bypass.test.ts` | NEW-NODE-MODULES | `node_modules` must be restricted |
| `sec_new_path_variation_bypass.test.ts` | NEW-PATH-VAR (NEW-PATH-VAR-12) | Path name variations must be blocked |
| `sec_new_unicode_control_bypass.test.ts` | NEW-UNICODE-CTRL | Unicode control character bypass must be blocked |
| `sec_new_venv_bypass.test.ts` | NEW-VENV | `.venv` must be restricted |
