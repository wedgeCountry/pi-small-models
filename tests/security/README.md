# Security Tests

Penetration tests demonstrating security findings. **These tests are intentionally failing** — each asserts the secure behavior that should prevent the vulnerability.

## Running
```bash
npx tsx --test tests/security/*.test.ts
```

## Current Status
- 40 failing tests (expected — they document unfixed vulnerabilities)
- 4 skipped tests (platform/toolchain unavailable)
- 0 unexpected passes

## Test Coverage
| Test File | Finding | Secure Behavior Being Tested |
|-----------|---------|-------------------------------|
| `sec_c3_option_injection.test.ts` | C3 | `Sandbox.relative()` must not return option-shaped paths |
| `sec_h1_agent_config.test.ts` | H1 | Config files (`.pi/`, `.agents/`, `AGENTS.md`) must not be writable |
| `sec_h2_copy_move_bypass.test.ts` | H2 | Copy/move/remove operations must not expose protected files |
| `sec_h3_denylist_gaps.test.ts` | H3 | Credential files restricted; `$HOME` as root refused |
| `sec_h4_gitdiff_failopen.test.ts` | H4 | `git_diff` must hide tracked `.env` files |
| `sec_h5_grep_broken.test.ts` | H5 | `grep` schema validates `pattern`; long scans must not timeout |
| `sec_m1_git_subdir.test.ts` | M1 | `git_diff` scoped to subdirectory must not leak parent changes |
| `sec_m3_permission_gate.test.ts` | M3 | Approval dialog describes mutations; tools gated with sandbox on |
| `sec_m4_resource_limits.test.ts` | M4 | `find` rejects absolute globs; `list` clamps depth; slow children timeout |
| `sec_m6_output_caps.test.ts` | M6 | `read` caps very long lines at byte limit |
| `sec_misc_defects.test.ts` | L9, D3 | `find_usages` handles multi-language repos |
| `sec_platform.test.ts` | L2, M5 | Windows compatibility |
| `sec_correctness.test.ts` | D1, D2, D5 | Default values and dotfile handling |
| `sec_low_hardening.test.ts` | L3 | Error messages don't echo absolute paths |
