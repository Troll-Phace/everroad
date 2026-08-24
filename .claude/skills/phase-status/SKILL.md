---
name: phase-status
description: "Project progress dashboard. Use for status checks or session-start orientation."
allowed-tools: Read Bash(git log *) Bash(git status) Bash(git diff --stat) Bash(gh issue list *) Grep Glob
---

# Project Status

From `.claude/state/progress.md`, `git log --oneline -10`, `git status`, and
`npm run verify`, report: current work item and status, recently shipped items,
build and test state, last commit, open issue counts by severity, anything
still in needs-triage, and next steps.
