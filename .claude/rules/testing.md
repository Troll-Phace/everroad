---
paths:
  - "src/**/*.test.ts"
  - "tests/**/*"
  - "**/*.test.*"
  - "**/*.spec.*"
---

# Testing Standards

Vitest, run through `npm test` (watch) or `npm run verify` (typecheck + tests +
build, which is what CI and the pre-push hook effectively check).

The pure-logic modules are where tests earn their keep, because they are
deterministic and DOM-free: `src/game/economy/`, `src/game/achievements/`,
`src/save/`, `src/audio/helpers.ts`, `src/world/roadPath.ts`, and the
formatters in `src/types.ts`. New behavior in those modules ships with tests
covering the happy path, the boundary (level 0, max level, prestige gate
exactly met), and the error path.

Tests are deterministic: no wall-clock reads, no `Math.random()` without a
seeded generator, no timing dependencies. Time and randomness are passed in.
Economy and progression tests assert against the tables in docs/ECONOMY.md, so
a test failing after a tuning change is the signal to update both together.

`src/world/`, `src/engine/`, and `src/ui/` are verified by a browser playtest
rather than unit tests — Three.js scene construction and DOM overlay behavior
cost more to mock than they return. Where a piece of that code is pure (a
curve, a blend function, a formatter), lift it out and test it.

Names describe behavior: `describe('applyTick')` / `it('scales earnings by the
combo multiplier only while active')`. Coverage target for the pure modules is
around 80%; the prestige, purchase, and save-migration paths sit near 100%
because a bug there destroys a player's progress.
