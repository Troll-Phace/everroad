---
name: phase-plan
description: "Plan the current work item into delegatable tasks. Use when starting a feature, fix batch, or milestone tier sweep."
argument-hint: "[work item, issue number, or milestone tier]"
allowed-tools: Read Grep Glob Bash(git status) Bash(git log *) Bash(gh issue view *) Bash(gh issue list *) mcp__Context7__resolve-library-id mcp__Context7__query-docs
---

# Plan Work Item

Take the item from $0, or from `.claude/state/progress.md` when no argument is
given. Read what defines it — the user's request, `gh issue view <n>` for a
filed issue, or the milestone tier's issue list — plus the docs/ARCHITECTURE.md
sections it touches, then produce a delegation plan.

Where the item depends on version-sensitive library APIs — Three.js r185
material, geometry, or renderer surfaces, or pmndrs postprocessing effect
construction — fetch current docs via Context7 (resolve-library-id →
query-docs) before finalizing. Skip Web Audio, DOM, and internal contracts;
their usage here is version-stable.

## Output

### {Item}: {Title} — {objective}

| # | Task | Assignee | Files | Depends on | Arch ref |
|---|------|----------|-------|-----------|----------|

Parallel groups, risk areas, acceptance criteria, and estimated delegations,
then wait for approval.
