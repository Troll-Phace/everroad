---
name: safe-commit
description: "Create a well-formed commit with safety checks. Use to commit or checkpoint work."
argument-hint: "[commit message]"
allowed-tools: Bash(git *) Read Grep
---

# Safe Commit

Review `git status` and `git diff --stat`; confirm no secrets, no `dist/`
output, and no unintended `package-lock.json` churn are staged; run
`npm run verify` if source changed. Stage specific files (not `git add .`),
commit as `type(scope): description` — feat, fix, perf, refactor, docs, test,
chore, with the scope naming the module (`world`, `economy`, `ui`, `audio`,
`save`) — and reference issues with `Refs #NN`, never `Closes`. $0 overrides
the message. Report hash and stats.
