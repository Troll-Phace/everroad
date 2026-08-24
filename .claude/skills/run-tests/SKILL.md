---
name: run-tests
description: "Run the test suite with reporting. Use after implementation work or for verification."
argument-hint: "[test file or name pattern]"
context: fork
allowed-tools: Bash Read Grep
---

# Run Tests

Run `npm run verify` for the full gate (typecheck + Vitest + build), or
`npx vitest run $0` when $0 narrows to a file or name pattern.

Report {passed}/{total} with duration. For failures: the test name, the error,
the relevant source context, and a likely fix. When an economy or progression
test fails, say whether the code or the expectation looks wrong and cite the
table in docs/ECONOMY.md.
