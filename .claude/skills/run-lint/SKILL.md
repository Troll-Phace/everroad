---
name: run-lint
description: "Run the type check and format check. Use before commits or after implementation."
context: fork
allowed-tools: Bash Read Grep Glob
---

# Lint & Format

Run `npm run typecheck` and `npm run format:check`. Report issues with file and
line. Fix formatting with `npm run format` on the specific files that changed
when asked — the repository has never been bulk reformatted, so a repo-wide
write would bury the real diff. Summary: {N} found, {M} fixed.
