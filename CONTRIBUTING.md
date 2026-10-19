# Contributing to pi-small-models

Thank you for your interest in contributing to pi-small-models! This document outlines the guidelines and expectations for contributors.

---

## Code of Conduct

By participating in this project, you agree to abide by the [Code of Conduct](CODE_OF_CONDUCT.md).

---

## How to Contribute

### Reporting Bugs

- Use the GitHub issue tracker to report bugs
- Include a clear description of the issue
- Provide steps to reproduce the bug
- Include relevant error messages and logs
- Mention the version of Node.js and operating system you're using

### Suggesting Enhancements

- Open a GitHub issue to discuss the enhancement
- Explain the use case and benefits
- Provide examples if applicable

### Submitting Pull Requests

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Ensure all tests pass (`npm test`)
5. Run linting (`npm run lint`)
6. Commit your changes with descriptive messages
7. Push to your fork (`git push origin feature/amazing-feature`)
8. Open a Pull Request to the `main` branch

---

## Development Setup

### Prerequisites

- Node.js 20+
- npm or yarn
- Git

### Installation

```bash
# Clone the repository
git clone https://github.com/wedgeCountry/pi-small-models.git
cd pi-small-models

# Install dependencies
npm install

# Run the build (if applicable)
npm run build

# Run tests
npm test
```

---

## Code Style Guidelines

### TypeScript

- Use strict TypeScript settings (`strict: true` in tsconfig.json)
- No `any` types allowed - use proper type definitions
- Use appropriate Error subclasses (RangeError, TypeError, etc.) instead of generic Error
- All public APIs must have JSDoc comments with `@param` and `@returns` tags

### Naming Conventions

- Use `camelCase` for variables and functions
- Use `PascalCase` for types, interfaces, and classes
- Use `UPPER_CASE` for constants
- Use descriptive names that reveal intent
- Avoid abbreviations unless widely understood

### Code Organization

- Each tool has its own file in `src/tools/`
- Tool definitions are in `src/tool_definitions/`
- Shared utilities should be in `src/utils/`
- Tests are in `tests/` directory

### Comments

- Explain WHY, not WHAT - the code should be self-explanatory for WHAT
- Add comments for complex algorithms, security decisions, and edge cases
- Remove redundant comments that just restate the code

---

## Testing

### Requirements

- All PRs must pass existing tests
- New features must include tests
- Security-related changes require additional security review
- Bug fixes should include regression tests

### Running Tests

```bash
# Run all tests
npm test

# Run specific test file
npm test -- tests/security/sec_m1_git_subdir.test.ts

# Run with coverage
npm run test:coverage
```

### Test Guidelines

- Tests should be isolated and not depend on external state
- Use temporary directories for file system tests
- Clean up after tests
- Test both success and error cases
- Include edge cases

---

## Security Review Process

### Changes Requiring Security Review

- Any modifications to sandbox logic (`src/sandbox/`)
- Changes to permission gates
- New tool additions
- Changes to path validation
- Modifications to file access patterns

### Security Review Checklist

- [ ] No new security vulnerabilities introduced
- [ ] Sandbox isolation maintained
- [ ] All user input properly validated
- [ ] No path traversal vulnerabilities
- [ ] Restricted files properly protected
- [ ] Error messages don't leak sensitive information

---

## Tool Addition Checklist

When adding a new tool:

- [ ] Tool definition in `src/tool_definitions/`
- [ ] Implementation in `src/tools/`
- [ ] Proper sandbox integration
- [ ] Input validation
- [ ] Error handling with appropriate error types
- [ ] Tests for the tool
- [ ] Documentation in README.md
- [ ] Security review if the tool accesses the file system

---

## Commit Message Guidelines

- Use the present tense ("Add feature" not "Added feature")
- Use the imperative mood ("Move cursor to..." not "Moves cursor to...")
- Limit the first line to 72 characters or less
- Reference issues and pull requests liberally after the first line
- Consider starting the commit message with an applicable emoji:
  - [32m:[0m new feature
  - [32m:[0m bug fix
  - [32m:[0m documentation
  - [32m:[0m performance
  - [32m:[0m refactor
  - [32m:[0m test
  - [32m:[0m chore

---

## Code Review Process

1. All PRs require at least one approval from a maintainer
2. Security-related changes require approval from a security reviewer
3. Address all review comments before merging
4. Squash and merge for clean history
5. Delete feature branches after merging

---

## Maintainers

- [@wedgeCountry](https://github.com/wedgeCountry) - Primary maintainer

---

## Resources

- [TypeScript Documentation](https://www.typescriptlang.org/docs/)
- [Node.js Documentation](https://nodejs.org/en/docs/)
- [Clean Code Principles](https://gist.github.com/wojtekmaj/945671128376b434878f5428545b2554)
- [Extreme Programming Practices](https://en.wikipedia.org/wiki/Extreme_programming_practices)

---

## License

By contributing to this project, you agree that your contributions will be licensed under the [MIT License](LICENSE).
