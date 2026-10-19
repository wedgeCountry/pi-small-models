# Tests

Test suite for the Pi extension tools.

## Running Tests
- Run all tests: `npm test`
- Run a single file: `node --test src/tests/find.test.ts`

## Key Files
- **sandbox.test.ts** – Core sandbox behavior specification
- **permissionGate.test.ts** – Permission gate and gated registry tests
- **index.test.ts** – Extension loading and tool registration tests

## Test Approach
Each tool test:
- Builds a temporary fixture using `fixtures.ts`
- Calls the plain async tool function directly (not the Pi wrapper)
- Tests against both enforced and unenforced sandbox modes
- Asserts on returned result objects, not rendered text
