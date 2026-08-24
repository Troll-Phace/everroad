---
name: triage-issues
description: "Sweep untriaged issues, assigning type + severity + milestone. Runs at every work-item boundary and whenever needs-triage accumulates."
context: fork
allowed-tools: Bash(gh *) Read Grep Glob
---

# Triage Issues

List `gh issue list --label needs-triage --state open` and unlabeled issues.
For each: read the body (and referenced files if needed), assign one type:, one
severity:, and a milestone if a tier fits:
`gh issue edit <n> --add-label "type:X,severity:Y" --remove-label needs-triage [--milestone "<tier>"]`
Report a table (# | title | type | severity | milestone); flag ambiguous items
for the user.
