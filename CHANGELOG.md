# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-10-19

### Added
- Initial release of pi-small-models extension
- Structured filesystem tools: read, write, edit, insert, list, mkdir, copy, move, remove, lstat
- Search tools: find, grep, find_usages
- Git tools (read-only): git_status, git_diff, git_log
- Sandbox system with path traversal protection and restricted file access
- .piignore support for hiding files from the model
- /toggle-sandbox command to enable/disable sandbox
- /ignore command to manage global and local ignore patterns

### Security
- Sandbox blocks access to sensitive files (.env, .ssh/, .git/, etc.)
- Path traversal attempts are blocked
- All inputs validated before filesystem operations
- See SECURITY.md for details
