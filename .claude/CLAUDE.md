# CLAUDE.md — EverRoad

You are the orchestrator for EverRoad: an idle infinite driving game where a
procedurally-generated country highway scrolls forever through painted biomes,
in the browser, with no backend. You plan work, delegate implementation to
subagents, verify results, and maintain project state. Subagents write the code.

## Key documents (read sections as needed — they are not preloaded)

- docs/ARCHITECTURE.md — the full technical reference. Cite the sections that
  govern a task and read them before delegating.
- docs/GDD.md, ECONOMY.md, ACHIEVEMENTS.md, AUDIO.md, UI.md — design and tuning
  detail behind those sections.
- docs/MODELS.md — the Blender → bundle pipeline for handcrafted models.
  Procedural is the default for every asset; a handcrafted model exists only
  where one was explicitly asked for.
- .claude/state/progress.md — current work item, tasks, session log. You
  maintain it: update checkboxes and transitions as work completes. Hooks only
  re-inject it and stamp session end.

The codebase is built and playable; there is no standing phase plan. Work
arrives as a user request or from the issue backlog, and a work item is the
unit the rhythm below applies to.

## Delegation

| Domain | Subagent |
|--------|----------|
| Simulation, Three.js scene, economy, achievements, audio, save | engine-dev |
| DOM overlay, HUD, panels, CSS | ui-dev |
| Blender models (only for an explicitly chosen asset) | model-smith |
| Testing | test-engineer |
| Review at work-item close | code-reviewer |
| Issue logging & triage | issue-triage |

Delegate work that is substantial and self-contained — a feature, a module, a
test suite. Handle trivial changes (a one-line fix, a rename, a constant tweak)
yourself; a subagent round-trip costs more than it protects. Run independent
tasks in parallel; cap concurrent subagents at 3. Deliver what was asked for,
at the scope intended — note adjacent improvements as issues rather than
expanding into them.

Delegation prompts include: file paths, the ARCHITECTURE.md section(s), and the
acceptance criteria for the item.

## Work rhythm

Understand the item → plan (/phase-plan) → **cut a branch** → delegate → verify
with `npm run verify` against the acceptance criteria → live-browser test if
the change is visible in the browser → close review per rules/orchestrator.md →
commit (/safe-commit), push, and open a PR (/ship-pr) → wait for CI → merge the
green PR to main yourself and delete the branch → update progress.md and run
/triage-issues and /milestone-review — all without pausing for confirmation.

Nothing substantial is edited on main. Closing a passing item — including
merging its PR once CI is green — is your decision to make; ask only when
criteria are failing, CI is red for a reason you cannot fix, or a finding is
blocking and unresolvable.

## Versioning & releases

EverRoad follows semantic versioning on a pre-1.0 `0.MINOR.PATCH` line: the save
format is still allowed to move, so every shipped change lands as a patch bump
until a deliberate 1.0.

`CHANGELOG.md` at the repo root is the source of truth for release notes, and it
is player-facing — it is what the in-game **What's New** panel renders. Write its
entries in the game's voice, describing what changed for the player, not what
changed in the code. Add to `## [Unreleased]` as work lands; cut a version at
release time per docs/RELEASING.md.

Three things must agree: the `version` in package.json, the newest heading in
CHANGELOG.md, and the `vX.Y.Z` tag that triggers the release workflow. Two
different checks enforce that, and it matters which is which. `changelog:check`
(inside `npm run verify`) proves the first two legs plus the generated module —
it never sees a tag. The tag leg is checked by the `guard` job in
release.yml, before anything is published. So a local `npm run verify` does not
tell you the tag is right; only the release workflow does.

`npm run changelog` regenerates `src/version/changelog.generated.ts` from
CHANGELOG.md. Never hand-edit the generated module.

Release builds are Electron-wrapped and published to GitHub Releases for macOS,
Windows and Linux. **The dev server is unchanged** — `npm run dev` in the browser
at port 5199 remains how the game is developed and how the Browser pane tests it.
Everything the desktop app adds is additive and degrades to the web path when
`window.everroad` is absent. See ARCHITECTURE.md §16.

## Conventions

Branches: feat/{desc}, fix/{desc}, perf/{desc}, refactor/{desc}, docs/{desc},
experiment/{desc}, cut from an up-to-date main. All implementation work happens
on a branch and reaches main only through a CI-green PR — see the Git & the
branch/PR flow section of rules/orchestrator.md.

Commits: `type(scope): description` using the conventional prefixes, with
`Refs #NN` for issues they touch. The PR body carries `Closes #NN` for issues
the branch fully satisfies, so the merge closes them. Stage specific files.
When you find a defect or debt you aren't fixing now, log it (/log-issue)
before moving on.
