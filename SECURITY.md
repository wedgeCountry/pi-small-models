# Security

## Sandbox Model

This extension enforces a strict sandbox that restricts the model to the project root directory. All file operations are validated through `src/sandbox/sandbox.ts` which:

- Blocks path traversal attempts (`..`, absolute paths, encoded variants)
- Prevents access to restricted files and directories (`.env`, `.ssh/`, `.git/`, credentials, etc.)
- Validates all inputs before they reach filesystem or glob operations

The sandbox is **on by default** and can be toggled off with `/toggle-sandbox` in Pi, which then requires explicit approval for each tool call.

## Known Vulnerabilities

### braces@3.0.3 (GHSA-vfj7-8cjw-p6xm) - High Severity

**Status**: Accepted risk

**Description**: braces is vulnerable to stack-exhaustion denial of service through deeply nested patterns.

**Rationale**: This vulnerability requires attacker-controlled glob patterns to be passed to the brace expansion engine. In this extension:

1. All path inputs are validated by `sandbox.ts:resolve()` before any filesystem operation
2. The sandbox blocks path traversal, malicious patterns, and restricts operations to the project root
3. The vulnerable code path in `braces` is not directly exposed to untrusted input

**Mitigation**: Input validation in the sandbox layer prevents exploitation of this vulnerability in practice. The glob patterns used by `fast-glob` are constructed from sandbox-validated paths.

**Dependency chain**: `fast-glob@3.3.3` → `micromatch@4.0.8` → `braces@3.0.3`

**Note**: The direct usage of `micromatch` has been replaced with `picomatch@2.3.2` (which has no dependencies and is not vulnerable) in our code. The remaining vulnerability is through the transitive dependency in `fast-glob`.

## Security Testing

This project includes comprehensive security tests in `tests/security/`. Run them with:

```bash
npx tsx --test tests/security/*.test.ts
```

These tests verify that:
- Restricted files cannot be read or written
- Path traversal attempts are blocked
- Git operations respect sandbox boundaries
- Resource limits prevent DoS attacks

## Reporting Security Issues

If you discover a security vulnerability, please report it by opening an issue in this repository.
