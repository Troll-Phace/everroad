---
name: log-issue
description: "Log a discovered defect, limitation, or debt item as a classified GitHub issue. Use the moment something is found and deferred."
argument-hint: "[short description]"
allowed-tools: Bash(gh *) Read Grep Glob
---

# Log Issue

Dedup first: `gh issue list --search "<keywords>" --state all` — comment on a
match instead of refiling. Otherwise classify (one type:, one severity:) and
create:
`gh issue create --title "<concise>" --label "type:X,severity:Y"
[--milestone "<tier>"] --body "<what / where (file:symbol) / repro / done>"`
(no fitting tier → add needs-triage).

A gameplay repro states the conditions it needs: car, upgrade levels, biome,
weather, time of day, active or autopilot — or the exported save code that
reproduces it. Report number + classification.
