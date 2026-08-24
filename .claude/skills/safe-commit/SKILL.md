---
name: safe-commit
description: "Create a well-formed commit with safety checks. Use to commit or checkpoint work."
argument-hint: "[commit message]"
allowed-tools: Bash(git *) Read Grep
---

# Safe Commit

Check `git branch --show-current` first: substantial work never commits to
main. If you are on main with real changes, move them to a branch
(`git switch -c <type>/<desc>`) before committing.

Review `git status` and `git diff --stat`; confirm no secrets, no `dist/`
output, and no unintended `package-lock.json` churn are staged; run
`npm run verify` if source changed. Stage specific files (not `git add .`),
commit as `type(scope): description` — feat, fix, perf, refactor, docs, test,
chore, with the scope naming the module (`world`, `economy`, `ui`, `audio`,
`save`) — and reference issues with `Refs #NN`, never `Closes` (issues close
via the PR body on merge). $0 overrides the message. Report hash and stats.

Committing is a checkpoint, not the end of the item — landing it is /ship-pr.
