---
name: deep-audit
description: "Scoped deep verification sweep of a subsystem or the whole codebase. Use at milestones, before releases, or when the user asks for a thorough audit."
argument-hint: "[scope: src/world, src/game/economy, src/ui, ... or 'full']"
disable-model-invocation: true
allowed-tools: Read Grep Glob Bash Agent
---

# Deep Audit

One bounded pass over $0 (default: the full codebase): delegate a reviewer to
read the scope against docs/ARCHITECTURE.md and the test suite against what it
claims to cover. The reviewer verifies each candidate finding with a concrete
reproduction before reporting it — a save code, a seeded road segment, a
simulated tick sequence, or a failing test. Unverified suspicions go in the
report's "unconfirmed" list, not into issues.

For EverRoad the recurring classes worth naming: module-boundary drift (DOM or
Three.js reaching into the pure modules), per-frame allocation and undisposed
geometry, save migration paths that no longer round-trip, economy constants
that have drifted from docs/ECONOMY.md, achievement conditions that can never
fire, and float precision across the floating-origin rebase.

Then close the loop in the same run: findings with small fixes are fixed and
tested now (delegate scoped fix agents); the rest are filed as classified
issues. One pass, one fix round, one report — audit output is not re-audited,
and fixes here get regression tests, not their own review cycle. Heavier
techniques (mutation testing, fuzzing a seed range, long-run soak) only when $0
or the user names them.

## Output

Findings table (severity, file, verified-how, fixed-or-filed) + what was not
covered.
