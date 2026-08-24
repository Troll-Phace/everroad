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
calls for, not merely "the code changed". Close via `Closes #NN` in the PR body
(the merge closes them), or `gh issue close NN` with a comment naming the merge
commit and how it was verified.
An issue whose done-criteria were only partially met stays open with a comment
saying what is left; a done-criteria you deliberately declined stays open and
gets the reason. Never close an issue you did not verify, and never close one to
tidy the backlog.

## Git & the branch/PR flow

Nothing substantial lands on main directly. Every work item — feature, fix
batch, milestone sweep, refactor — starts by cutting a branch and ends by
merging a green PR. The only edits allowed straight on main are trivial
non-code housekeeping (a progress.md line, a typo in a doc) with nothing to
verify; when in doubt, branch.

Branch names: feat/{desc}, fix/{desc}, perf/{desc}, refactor/{desc},
docs/{desc}, experiment/{desc}. Cut from an up-to-date main:
`git fetch origin && git switch -c feat/thing origin/main`.

The close sequence, run without pausing for confirmation:

1. **Verify locally** — `npm run verify` passes against the item's acceptance
   criteria.
2. **Live-browser test** — only when the change is observable in the browser
   (rendering, HUD/panels, input, audio, save/load behaviour). Use the Browser
   pane (`preview_start` with the `everroad-dev` launch config), exercise the
   change, check the console for errors, and capture a screenshot for
   visual work. Skip it for pure logic, type, test, or tooling changes and say
   in the PR body that it was not applicable.
3. **Close review** — code-reviewer on the branch diff; blocking findings
   resolved, the rest routed to issue-triage.
4. **Commit** (/safe-commit) and push: `git push -u origin <branch>`. Let the
   pre-push hook run; never bypass it with `--no-verify`.
5. **Open the PR** (/ship-pr) against main with a body carrying summary, test
   plan (including the live-browser result or why it was skipped), and issue
   references. Issues fully satisfied go in the PR body as `Closes #NN` — the
   merge closes them; commits themselves use `Refs #NN`.
6. **Wait for CI** — `gh pr checks <n> --watch`. A red check is your problem to
   fix: push follow-up commits to the same branch until it is green. Never
   merge with failing or pending checks, and never merge with admin override.
7. **Merge and clean up** — once CI is green, merge it yourself:
   `gh pr merge <n> --squash --delete-branch`, then
   `git switch main && git pull`. Confirm the PR shows merged/closed and that
   the `Closes #NN` issues actually closed; close any stragglers manually with
   a comment naming the merge commit.
8. **Advance** — update progress.md, run /triage-issues and /milestone-review.

No force-push to main (the deny list enforces it); force-pushing your own
feature branch is fine when a rebase calls for it. Stage specific files.
Secrets never enter commits (the deny list and protected-file hook enforce
this; treat near-misses as findings). The pre-push hook in .githooks/pre-push
mirrors CI — let it run rather than bypassing it.

Ask before merging only when CI is red for a reason you cannot fix, when the
review left a blocking finding unresolved, or when the branch has drifted far
enough from main that the merge is no longer mechanical. A green PR that meets
its acceptance criteria is yours to merge.

## Recovery

Failed verification goes back to the implementing agent with specific feedback.
Use /rewind for in-session rollback, branches for cross-session recovery,
worktrees for risky experiments. After two failed correction loops on the same
task, stop and re-plan rather than iterating a third time.
