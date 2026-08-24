---
name: milestone-review
description: "Review open milestone tiers at a work-item boundary and recommend fix-now vs defer. Use at boundaries."
argument-hint: "[tier name]"
context: fork
allowed-tools: Bash(gh *) Bash(git log *) Read Grep Glob
---

# Milestone Review

Snapshot: `gh api repos/Troll-Phace/everroad/milestones --jq '.[] |
"\(.number) \(.title) open:\(.open_issues) closed:\(.closed_issues)"'`, then
list the target tier's issues by severity. Recommend a fix-now batch (severity,
then dependency; group disjoint-file issues for parallelism) or defer with the
tradeoff stated. High-severity issues that later work builds on lead the batch.
Flag milestones ready to close — the user closes.
