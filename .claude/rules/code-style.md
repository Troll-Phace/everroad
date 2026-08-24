---
paths:
  - "src/**/*.ts"
  - "*.ts"
---

# Code Standards — Everroad

TypeScript in strict mode; `npm run typecheck` is the lint gate and stays
clean. Prettier is applied per-file by the PostToolUse hook (single quotes,
semicolons, 2-space indent, 100 columns) — the repository has never been bulk
reformatted, so a file only changes shape when it is edited.

The module boundaries in docs/ARCHITECTURE.md §3 are the load-bearing
convention here, and they are enforced by review rather than by tooling:

- Shared types come from `src/types.ts` only. A module may additionally import
  from its own subdirectory. Adding a cross-module type anywhere else splits
  the contract.
- `src/game/`, `src/save/`, and `src/audio/` are pure logic — no DOM, no
  Three.js imports. This is what keeps them unit-testable.
- `src/ui/` touches DOM only, reads state, and mutates it through `UIActions`.
- `src/world/` and `src/engine/` never mutate currencies; they build an
  `EconomyContext` per tick and hand it to `economy.applyTick`.
- Cross-module notifications ride the typed `EventBus` in `src/events.ts`.

Naming: camelCase for values, PascalCase for types and classes, SCREAMING_SNAKE
for tuning constants. Factory functions read `createX` and return a closed-over
interface from `types.ts`; that is the shape every module uses instead of
classes. Exported functions and every tuning constant carry a doc comment
saying what the number means and where its rationale lives.

Everroad runs one `requestAnimationFrame` loop, so per-frame code is
performance-sensitive: allocate outside the loop, reuse `Vector3`/`Color`
scratch objects, and prefer instanced meshes and pooling over creating scene
objects per frame. `dt` is clamped in `main.ts` — hot paths take `dt` as an
argument rather than reading wall-clock time.

Avoid: `any` and non-null assertions without a comment giving the reason;
`setTimeout`-driven game logic (the loop owns time); magic numbers in `world/`
that belong in a biome or tuning table; and new runtime dependencies — the game
ships with zero external assets and a deliberately small dependency set.
