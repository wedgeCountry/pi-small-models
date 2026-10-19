# pi-small-models Refactoring Plan

*Comprehensive implementation plan to address code review findings and improve code quality, security, and maintainability.*

---

## 📋 Overview

This document outlines a prioritized plan to address all issues identified in the critical code review. Each task is checkable and includes clear actions and rationale.

**Current State**: Strong architecture, excellent security testing, good test coverage. Needs polish in code quality, process, and some security hardening.

**Target State**: Production-grade code that fully embodies Clean Code, Extreme Programming, and Zen of Python principles.

---

## 🎯 Success Criteria

| **Priority** | **Criteria** |
|--------------|--------------|
| **High** | All security vulnerabilities fixed, all security tests pass, no console.log in tests, no dead code, CI pipeline active |
| **Medium** | No `any` types, consistent error handling, ESLint/Prettier configured, clear naming, contribution guidelines |
| **Low** | All functions single-purpose, all APIs documented, changelog maintained, performance optimized |

---

## 🔥 HIGH PRIORITY - Critical Security & Bugs

*Must be addressed immediately to maintain security posture and fix known vulnerabilities.*

### Security Fixes

- [ ] **Fix Git tools repository scope vulnerability**
  **What**: Modify `git_status.ts`, `git_diff.ts`, and `git_log.ts` to filter results to only include files within the sandbox root, even when the git repository extends beyond it.
  **Why**: Currently, git tools can expose changes, history, and file names from parent directories outside the sandbox root (confirmed in `sec_m1_git_subdir.test.ts`). This violates the sandbox isolation principle.
  **Implementation**: Add path filtering in each git tool to only return data for paths that are within `sb.root`. Use `sb.allowsReported()` for consistency with other tools.
  **Files**: `src/tools/git_status.ts`, `src/tools/git_diff.ts`, `src/tools/git_log.ts`
  **Tests**: Verify with `tests/security/sec_m1_git_subdir.test.ts`

- [ ] **Verify and harden copy/move restricted content checks**
  **What**: Audit `copy.ts` and `move.ts` to ensure `hasRestrictedDescendant()` is called for ALL directory operations, and verify the implementation catches all edge cases.
  **Why**: Security tests (`sec_h2_copy_move_bypass.test.ts`) show that copying/moving a parent directory can expose nested restricted files (`.env`, `.ssh/`, etc.).
  **Implementation**: Review all code paths in `copyFile()` and `moveFile()` that handle directories. Ensure recursive operations always check for restricted descendants. Add additional tests for edge cases.
  **Files**: `src/tools/copy.ts`, `src/tools/move.ts`
  **Tests**: Verify with `tests/security/sec_h2_copy_move_bypass.test.ts`

- [ ] **Audit and improve URL encoding bypass protection**
  **What**: Review the `decodeURIComponent` logic in `sandbox.ts:resolve()` to ensure it catches all URL encoding variations (%, %2e, %2f, %5c, etc.).
  **Why**: URL-encoded paths could potentially bypass path restrictions. While partially addressed, the recursive validation needs verification.
  **Implementation**: Add comprehensive tests for various URL encoding patterns. Consider creating a canonical path normalization function that handles all encoding cases.
  **Files**: `src/sandbox/sandbox.ts`
  **Tests**: Add new tests in `tests/security/`

### Code Health & Stability

- [ ] **Remove all console.log statements from test files**
  **What**: Delete debug `console.log` calls in `tests/edit_sandbox_unicode.test.ts` (6 occurrences) and `tests/peek_typescript.test.ts` (1 occurrence).
  **Why**: Debug output in tests can leak sensitive data in CI logs and indicates incomplete cleanup. Production-ready code should have no debug statements.
  **Implementation**: Search for and remove all `console.log`, `console.error`, `console.warn` from test files. Use proper assertion messages instead.
  **Files**: `tests/edit_sandbox_unicode.test.ts`, `tests/peek_typescript.test.ts`

- [ ] **Remove dead code and commented-out imports**
  **What**: Remove commented-out code in `index.ts` (peek tool, search tool) and any other dead code.
  **Why**: Dead code creates maintenance burden, confuses contributors, and can hide actual issues. It also violates the Zen of Python principle: "If the implementation is hard to explain, it's a bad idea."
  **Implementation**: Search for `// ` comments that disable code (not explanatory comments). Remove or document why code is intentionally disabled.
  **Files**: `index.ts`, audit all files for dead code

- [ ] **Add CI/CD pipeline with GitHub Actions**
  **What**: Create `.github/workflows/test.yml` with test execution on push/PR, and `.github/workflows/security-audit.yml` for dependency scanning.
  **Why**: Without CI, code quality and security regressions can slip through. This is a fundamental XP practice for maintaining quality.
  **Implementation**:
  - Test workflow: Run `npm test` on Node 20+
  - Security workflow: Run `npm audit` and dependency scanning
  - Add badges to README.md
  **Files**: `.github/workflows/test.yml`, `.github/workflows/security-audit.yml`

---

## ⚡ MEDIUM PRIORITY - Code Quality & Process Improvements

*These improve maintainability, type safety, and developer experience.*

### Type Safety & Code Correctness

- [ ] **Eliminate all `any` types and unsafe casts**
  **What**: Fix the `as any` in `toolValidation.ts:101` and unsafe casts in `read.ts`.
  **Why**: TypeScript's value is type safety. `any` defeats this purpose and can hide bugs. It violates "Explicit is better than implicit."
  **Implementation**:
  - In `toolValidation.ts`: Use proper type guards instead of `as any`
  - In `read.ts`: Add proper type definitions for SDK result types
  - Run `tsc --noImplicitAny` to catch all instances
  **Files**: `src/backend/toolValidation.ts`, `src/tools/read.ts`

- [ ] **Use appropriate Error subclasses consistently**
  **What**: Replace generic `Error` throws with specific subclasses (`RangeError`, `TypeError`, `PermissionError`) where appropriate.
  **Why**: Enables better error handling and debugging. Follows Node.js conventions and makes errors more actionable.
  **Implementation**:
  - `RangeError` for invalid ranges (offset beyond file length)
  - `TypeError` for invalid parameter types
  - `PermissionError` for sandbox violations (though `SandboxError` is already used)
  - Document error types in tool definitions
  **Files**: All tool implementation files

- [ ] **Extract common utilities to reduce duplication**
  **What**: Create shared utility functions for repeated patterns (parent directory creation, signal checking, error formatting).
  **Why**: DRY principle violation. Duplicated code increases maintenance burden and risk of inconsistencies.
  **Implementation**:
  - `src/utils/fsUtils.ts`: `ensureParentDirectory()`, `pathExists()`
  - `src/utils/validation.ts`: `checkAborted()`, `validatePositiveInteger()`
  - `src/utils/errors.ts`: `formatErrorMessage()`, standardized error formatting
  **Files**: Create new utility files, refactor existing files to use them

### Code Clarity & Maintainability

- [ ] **Improve naming for clarity and consistency**
  **What**: Rename unclear identifiers to reveal intent.
  **Why**: "There should be one-- and preferably only one --obvious way to do it" (Zen of Python). Good names make code self-documenting.
  **Implementation**:
  - `sb` → `sandbox` (in function parameters and local variables)
  - `opts` → `options` (consistency)
  - `fg` → `foregroundColor` or `color` (in theme usage)
  - `callName` → `formatToolName`
  - `oneLine` → `createSingleLineRenderer`
  - Add JSDoc `@param` comments for all function parameters
  **Files**: All TypeScript files

- [ ] **Replace magic numbers and strings with named constants**
  **What**: Extract all unexplained numeric/string constants into named variables with descriptive names.
  **Why**: Magic values violate "Explicit is better than implicit." They make code harder to understand and maintain.
  **Implementation**:
  - `DEFAULT_MAX_LINES = 2000` → `MAX_READ_LINES = 2000` with comment
  - `DEFAULT_MAX_BYTES = 50 * 1024` → `MAX_READ_BYTES = 52428800` with comment
  - `DEFAULT_TIMEOUT_MS = 5000` → `GREP_TIMEOUT_MS = 5000` with rationale
  - `RECORD_SEP = "\x1e"` → Add comment explaining ASCII record separator
  - All regex patterns in `policy.ts` should have comments explaining their purpose
  **Files**: All TypeScript files, especially `src/tools/read.ts`, `src/tools/grep.ts`, `src/sandbox/policy.ts`

- [ ] **Improve comment quality: explain WHY, not WHAT**
  **What**: Review all comments. Remove redundant ones (explaining obvious code) and enhance explanatory ones (explaining rationale).
  **Why**: "If the implementation is hard to explain, it's a bad idea" (Zen of Python). Comments should add value, not noise.
  **Implementation**:
  - Remove comments like "Resolve to absolute path" when the code `path.resolve()` is self-explanatory
  - Add comments explaining complex algorithms (mutation queue, path validation logic)
  - Add comments explaining security decisions
  - Document edge cases and why specific approaches were chosen
  **Files**: All TypeScript files

- [ ] **Add consistent import style**
  **What**: Standardize import statements across the codebase.
  **Why**: Consistency reduces cognitive load and improves readability.
  **Implementation**:
  - Prefer named imports for Node.js built-ins: `import { readFile, writeFile } from "node:fs/promises"`
  - Use consistent namespace imports for third-party: `import fg from "fast-glob"`
  - Group imports: Node built-ins, third-party, local
  - Add ESLint rule to enforce consistency
  **Files**: All TypeScript files

### Tooling & Process

- [ ] **Add ESLint with TypeScript support**
  **What**: Configure ESLint with `@typescript-eslint` plugins for code quality enforcement.
  **Why**: Automated linting catches issues early and enforces consistent style. This is a core XP practice.
  **Implementation**:
  - Add `eslint`, `@typescript-eslint/parser`, `@typescript-eslint/eslint-plugin`
  - Configure rules for: no `any`, no `console.log`, consistent imports, etc.
  - Add to CI pipeline
  - Add pre-commit hook
  **Files**: `.eslintrc.json`, `package.json`

- [ ] **Add Prettier for code formatting**
  **What**: Configure Prettier with consistent settings (2-space indent, semicolons, trailing commas).
  **Why**: Eliminates formatting debates and ensures consistent code style. "Readability counts" (Zen of Python).
  **Implementation**:
  - Add Prettier with TypeScript support
  - Configure: `semi: true, singleQuote: false, tabWidth: 2, trailingComma: "es5"`
  - Add `.prettierignore` for generated files
  - Add pre-commit hook
  **Files**: `.prettierrc`, `.prettierignore`, `package.json`

- [ ] **Add CONTRIBUTING.md**
  **What**: Create contribution guidelines documenting code style, testing requirements, and security review process.
  **Why**: Enables collective code ownership (XP principle). Makes it easier for new contributors to understand expectations.
  **Implementation**:
  - Code style guide (link to ESLint/Prettier config)
  - Testing requirements (all PRs must pass existing tests, new features need tests)
  - Security review process for changes to sandbox/policy
  - Pull request template
  - Tool addition checklist
  **Files**: `CONTRIBUTING.md`, `.github/PULL_REQUEST_TEMPLATE.md`

- [ ] **Add pre-commit hooks with Husky**
  **What**: Set up Husky to run linting and tests before commits.
  **Why**: Catches issues before they're pushed, improving code quality at the source.
  **Implementation**:
  - Add Husky and lint-staged
  - Run ESLint on staged files
  - Optionally run tests on staged changes
  **Files**: `package.json`, `.husky/`

---

## 📋 LOW PRIORITY - Polish & Future Enhancements

*These are nice-to-have improvements for long-term maintainability.*

### Code Structure Improvements

- [ ] **Refactor long functions into smaller, focused ones**
  **What**: Split `sandbox.ts:resolve()` (100+ lines) and other long functions into smaller, single-purpose functions.
  **Why**: "Simple is better than complex" and "Flat is better than nested" (Zen of Python). Smaller functions are easier to test, understand, and maintain.
  **Implementation**:
  - `resolve()` → Split into: `validatePathCharacters()`, `validateNoTraversal()`, `validateNoRestrictedPatterns()`, `resolveToAbsolute()`
  - `walkDirectoryForRestricted()` → Extract helper functions for symlink handling, directory checking
  - Each function should do ONE thing and do it well
  **Files**: `src/sandbox/sandbox.ts`, `src/tools/*`

- [ ] **Improve error messages with context codes**
  **What**: Add error codes to all custom errors for programmatic handling.
  **Why**: Makes error handling more robust and enables better error reporting to users.
  **Implementation**:
  - Extend `SandboxError` to include error codes
  - Add error codes to validation errors
  - Document error codes in API documentation
  **Files**: `src/sandbox/sandbox.ts`, all error-throwing locations

- [ ] **Add performance optimizations for path validation**
  **What**: Cache realpath resolutions and combine regex checks in sandbox validation.
  **Why**: For bulk operations (find, grep), repeated path validations add overhead.
  **Implementation**:
  - Add LRU cache for `fs.realpathSync` results
  - Combine multiple regex tests into single compiled regex where possible
  - Benchmark before and after
  **Files**: `src/sandbox/sandbox.ts`

### Documentation

- [ ] **Add CHANGELOG.md**
  **What**: Create a changelog to track project changes, following Keep a Changelog format.
  **Why**: Helps users and contributors understand what's changed between versions. Important for transparency.
  **Implementation**:
  - Follow [Keep a Changelog](https://keepachangelog.com/) format
  - Add to release process
  - Link from README.md
  **Files**: `CHANGELOG.md`

- [ ] **Add SECURITY.md**
  **What**: Document the security model, threat model, and reporting process.
  **Why**: Security transparency builds trust. Explains the sandbox approach, what's protected, and how to report vulnerabilities.
  **Implementation**:
  - Explain sandbox architecture
  - Document protected paths and patterns
  - Explain the permission gate mechanism
  - Provide security contact information
  - Document known limitations
  **Files**: `SECURITY.md`

- [ ] **Add JSDoc to all public APIs**
  **What**: Add comprehensive JSDoc comments to all exported functions and tool definitions.
  **Why**: Improves IDE support, makes API self-documenting, and helps contributors understand contracts.
  **Implementation**:
  - Add `@param`, `@returns`, `@throws` to all public functions
  - Document edge cases and constraints
  - Use `@internal` for non-public APIs
  **Files**: All TypeScript files with exported functions

### Testing Improvements

- [ ] **Add property-based testing for path validation**
  **What**: Use a library like `fast-check` to generate random path inputs and verify sandbox validation.
  **Why**: Helps catch edge cases in complex validation logic that manual tests might miss.
  **Implementation**:
  - Generate random valid and invalid paths
  - Test that valid paths are accepted
  - Test that invalid paths are rejected with appropriate errors
  - Focus on edge cases: Unicode, encoding, traversal attempts
  **Files**: `tests/security/property_based_sandbox.test.ts`

- [ ] **Add integration tests for multi-tool workflows**
  **What**: Test common workflows like grep → read → edit chains to ensure consistent behavior.
  **Why**: Tools are designed to work together. Integration tests verify the system works as a whole.
  **Implementation**:
  - Test: grep for pattern → read file at result → edit file
  - Test: find files → copy/move operations
  - Test: git operations with sandbox constraints
  **Files**: `tests/integration/workflows.test.ts`

---

## 📅 Suggested Execution Timeline

### Week 1: Critical Security & Stability
*Focus: Fix vulnerabilities and ensure basic quality*

**Tasks:**
- [ ] Fix Git tools repository scope vulnerability
- [ ] Verify and harden copy/move restricted content checks
- [ ] Audit and improve URL encoding bypass protection
- [ ] Remove all console.log statements from test files
- [ ] Remove dead code and commented-out imports
- [ ] Add CI/CD pipeline with GitHub Actions

**Estimated Time**: 2-3 days
**Success Criteria**: All security tests pass, no debug output in tests, CI active

---

### Week 2: Code Quality Foundations
*Focus: Type safety, naming, and tooling*

**Tasks:**
- [ ] Eliminate all `any` types and unsafe casts
- [ ] Use appropriate Error subclasses consistently
- [ ] Extract common utilities to reduce duplication
- [ ] Improve naming for clarity and consistency
- [ ] Replace magic numbers and strings with named constants
- [ ] Add ESLint with TypeScript support
- [ ] Add Prettier for code formatting

**Estimated Time**: 3-4 days
**Success Criteria**: No `any` types, consistent error handling, linting configured

---

### Week 3: Process & Documentation
*Focus: Contribution process and code clarity*

**Tasks:**
- [ ] Add CONTRIBUTING.md
- [ ] Add pre-commit hooks with Husky
- [ ] Improve comment quality: explain WHY, not WHAT
- [ ] Add consistent import style
- [ ] Add JSDoc to all public APIs

**Estimated Time**: 2-3 days
**Success Criteria**: Contribution process documented, code is well-commented, pre-commit hooks active

---

### Week 4: Polish & Enhancements
*Focus: Long-term maintainability*

**Tasks:**
- [ ] Refactor long functions into smaller, focused ones
- [ ] Improve error messages with context codes
- [ ] Add performance optimizations for path validation
- [ ] Add CHANGELOG.md
- [ ] Add SECURITY.md
- [ ] Add property-based testing for path validation
- [ ] Add integration tests for multi-tool workflows

**Estimated Time**: 3-5 days
**Success Criteria**: All functions single-purpose, all APIs documented, performance optimized

---

## 📊 Tracking Metrics

| **Metric** | **Current** | **Target** | **Status** |
|------------|-------------|------------|------------|
| Security test passes | ~24 | 24+ (all passing) | [ ] |
| `any` types in codebase | 1+ | 0 | [ ] |
| console.log in tests | 7 | 0 | [ ] |
| Dead code instances | 2+ | 0 | [ ] |
| CI pipelines | 0 | 2 (test, security) | [ ] |
| ESLint rules | 0 | 50+ | [ ] |
| Prettier configured | No | Yes | [ ] |
| Documented public APIs | ~50% | 100% | [ ] |
| CONTRIBUTING.md | No | Yes | [ ] |
| CHANGELOG.md | No | Yes | [ ] |
| SECURITY.md | No | Yes | [ ] |

---

## 🎯 Priority Summary

### 🔴 High Priority (Do Now - Security Critical)
- Git tools scope fix
- Copy/move restriction verification
- URL encoding protection audit
- Remove debug console.log
- Remove dead code
- Add CI/CD

### 🟡 Medium Priority (Next - Quality Improvements)
- Eliminate `any` types
- Consistent error handling
- Extract common utilities
- Improve naming
- Replace magic values
- Add ESLint/Prettier
- Add CONTRIBUTING.md
- Add pre-commit hooks

### 🟢 Low Priority (Future - Polish)
- Refactor long functions
- Error message improvements
- Performance optimizations
- Add CHANGELOG.md
- Add SECURITY.md
- Property-based testing
- Integration tests

---

## 📝 Notes

1. **Testing**: Each change should be accompanied by tests. For security fixes, ensure existing security tests pass and add new tests for edge cases.

2. **Review**: All changes, especially security-related ones, should be peer-reviewed before merging.

3. **Documentation**: Update documentation as you go. Don't leave documentation as a separate phase.

4. **Incremental Progress**: This plan is designed to be executed incrementally. Each completed task improves the project.

5. **Tracking**: Use GitHub Projects or Issues to track progress on these tasks.

---

## 🔗 Related Documents

- [README.md](./README.md) - Project overview
- [doc/architecture.md](./doc/architecture.md) - Architecture documentation
- [doc/tool-pattern.md](./doc/tool-pattern.md) - Tool addition guide
- [AGENTS.md](./AGENTS.md) - AI agent guidance

---

*Last updated: $(date)*
*Plan version: 1.0*
