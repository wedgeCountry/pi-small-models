# Source (src)

Implementation of the Pi extension registered in `../index.ts`.

## Directory Structure

- **tool_definitions/** – Static tool definition objects (name, description, parameters schema)
- **tools/** – Tool registration and plain async functions
- **sandbox/** – Sandbox implementation:
  - `policy.ts` – Protected patterns and path checks
  - `sandbox.ts` – `Sandbox` object with `resolve`, `relative`, `entryFilter`, `allowsReported`
  - `permissionGate.ts` – Gated registry and permission gate handler
- **commands/ignore.ts** – Shared ignore globs for `find`, `grep`, `list`
- **backend/mutationQueue.ts** – Serializes file mutations to prevent race conditions

## Tests
See `../tests/README.md` for test suite details.

## Architecture
See `../doc/architecture.md` for overview or `../AGENTS.md` for full writeup.
