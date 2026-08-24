---
name: ship-pr
description: "Push the current branch, open a PR against main, wait for CI, then merge and clean up. Use to land a finished work item."
argument-hint: "[pr title]"
allowed-tools: Bash(git *) Bash(gh *) Bash(npm run *) Read Grep
---

# Ship PR

Lands the current branch on main. Never run this from main — if `git branch
--show-current` is `main`, stop and move the work onto a branch first.

## Preconditions

- `npm run verify` passes.
- If the change is observable in the browser, the live-browser test has already
  been done (Browser pane, `everroad-dev` launch config): change exercised,
  console clean, screenshot captured. Note the result; if it was not
  applicable, say so explicitly in the test plan.
- Close review (code-reviewer) is done and blocking findings are resolved or
  logged.
- Working tree is clean and everything intended is committed (/safe-commit).

## Steps

1. `git push -u origin $(git branch --show-current)` — let the pre-push hook
   run; never `--no-verify`.
2. `gh pr create --base main --title "<type(scope): description>" --body ...`
   with this body shape:

   ```
   ## Summary
   <what changed and why, 2-4 bullets>

   ## Test plan
   - `npm run verify` — <result>
   - Live-browser: <what was exercised / "not applicable — no browser-visible change">

   ## Issues
   Closes #NN
   Refs #NN
   ```

   `Closes` only for issues whose done-criteria the branch fully satisfies;
   everything else is `Refs`.
3. `gh pr checks <n> --watch` until every check reports a conclusion. Red is
   yours to fix: diagnose, commit the fix to the same branch, push, watch
   again. Do not merge with a failing or pending check, and never use an admin
   override.
4. Green → `gh pr merge <n> --squash --delete-branch`.
5. `git switch main && git pull && git branch -d <branch>` (local cleanup if it
   still exists).
6. Verify the outcome: `gh pr view <n>` shows MERGED, and the `Closes #NN`
   issues are actually closed. Close any straggler with `gh issue close NN -c`
   naming the merge commit and how it was verified.
7. Report: PR number and URL, merge commit, checks that ran, issues closed.

## Stop and ask

Only when CI is red for a reason you cannot fix, a blocking review finding is
unresolved, or the merge is non-mechanical (conflicts, main has drifted). A
green PR meeting its acceptance criteria is yours to merge.
