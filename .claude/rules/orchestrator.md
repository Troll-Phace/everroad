# Orchestrator Rules

## Review gate

A work item (or any major code-changing task) closes with a code-reviewer pass:
after implementation wraps and verification passes, delegate the diff to
code-reviewer. Findings it doesn't fix route to issue-triage (critical/warning/
suggestion → severity labels). Resolve or log blocking findings, then advance
progress.md and commit. One pass per close is the norm — re-review only what
changed in response to blocking findings, and don't add review passes elsewhere;
`npm run verify` covers intermediate verification. When the review pass is done
and blocking findings are resolved or logged, the item is closed: commit and
advance. Completion needs no permission.

## Proportionality

Severity is an effort and ordering signal, not just a label. High-severity
issues that later work builds on are fixed before that work; low and medium
issues get minutes, not hours — a scoped fix or a filed issue, then move on.
When debugging exceeds three failed hypotheses or ~15 minutes without a root
cause, stop: file what you know (symptoms, rates, attempts) as an issue and
continue. A frame-rate or audio glitch that does not reproduce in isolation is
an environment finding — file it, don't chase it. Match verification depth to
the change: a tuning-constant tweak needs a look and a playtest, not a review
program.

## Issue capture

A defect, limitation, perf smell, or debt item you aren't fixing in the current
task gets logged before you move on — /log-issue or issue-triage. Search first
(`gh issue list --search "<keywords>" --state all`); comment on a duplicate
rather than filing twice. Every issue: one type: label, one severity: label, a
milestone if a tier fits (else needs-triage), and a body with what / where /
repro / done-criteria. Milestones are themed breakpoint tiers swept at natural
roadmap breaks. At work-item boundaries, /milestone-review decides whether to
sweep an open tier. Triage is part of closing: an item does not close with
things in needs-triage — /triage-issues runs at the boundary alongside
/milestone-review.

You close issues yourself once a fix is confirmed — verified against the issue's
stated done-criteria by `npm run verify` plus whatever direct check the issue
calls for, not merely "the code changed". Close via `Closes #NN` in the commit,
or `gh issue close NN` with a comment naming the commit and how it was verified.
An issue whose done-criteria were only partially met stays open with a comment
saying what is left; a done-criteria you deliberately declined stays open and
gets the reason. Never close an issue you did not verify, and never close one to
tidy the backlog.

## Git

Branches: feat/{desc}, fix/{desc}, perf/{desc}, experiment/{desc}. No
force-push to main (the deny list enforces it). Stage specific files. Secrets
never enter commits (the deny list and protected-file hook enforce this; treat
near-misses as findings). The pre-push hook in .githooks/pre-push mirrors CI —
let it run rather than bypassing it. PR bodies: summary, test plan, issue
references.

## Recovery

Failed verification goes back to the implementing agent with specific feedback.
Use /rewind for in-session rollback, branches for cross-session recovery,
worktrees for risky experiments. After two failed correction loops on the same
task, stop and re-plan rather than iterating a third time.
