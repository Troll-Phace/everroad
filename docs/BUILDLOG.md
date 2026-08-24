# EverRoad — Build Log

## 2026-08-24 — Session 1

- **Spec locked** via Q&A: hybrid idle/active loop, chase cam, full offline progress,
  blended biomes (hero = autumn/Emberwood with god-ray sunsets), multi-currency +
  prestige, garage + parts, 100+ achievements, winding road, cozy-medium pacing,
  generative audio, glassy UI, local saves. Name: **EverRoad**.
- **Stack chosen:** Three.js + pmndrs `postprocessing` + Vite + TS. Zero assets/backend.
- Scaffolded project; wrote `src/types.ts` as the frozen inter-module contract.
- Docs: GDD, ARCHITECTURE, README.
- Spawned parallel subagents: economy, achievements, audio, save, UI.
- Core engine (road/chunks/biomes/sky/car/camera/pickups/postfx) built in main session.

### Integration & browser verification

- Wired all modules in `main.ts`; whole-project typecheck + Vite build green.
- Repo: private GitHub `Troll-Phace/everroad`, CI (typecheck+build+dist artifact)
  on every push, local `.githooks/pre-push` mirrors CI so broken pushes can't leave
  the machine. Regular commits at working breakpoints.
- **Bugs found & fixed while testing in the browser:**
  - Center-line dash color bled across the whole road via vertex-color
    interpolation → added guard columns to the road cross-section.
  - Hidden/throttled tabs ran the sim in slow motion → surplus `dt` is now banked
    as idle earnings (same math as offline progress).
  - Magnet + combo worked while idle, diluting active play → both gated on
    "hands on wheel".
  - Trees could swallow the chase camera → min lateral 10.5 m + scale cap near road.
  - Autopilot straddled the center line → right-lane bias with gentle wander.
  - Duplicate "Esc Esc" hint on the settings panel.
- **Verified in-browser:** autopilot & manual steering, drift combo (cap, decay,
  meter), near-miss detection, coin patterns + magnet, car purchase/select with
  mesh swap, per-car upgrades, prestige loop (tokens, resets, scaling gate,
  Horizon shop unlock), achievements + toasts + bounty chaining, offline modal
  (`?fakeaway=` dev param), save persistence/export/import round-trip, all 8
  biomes, day/night with god-ray sunsets, night stars + aurora, rain/leaves/fog
  weather, biome-tinted UI accents, 60 fps with bounded chunk pool (26 live).
- Audio: added **coin runs** — consecutive pickups walk up/down a random
  major/minor/lydian scale rooted in the biome key (user request).

### Dev conveniences

- `window.__everroad` (DEV only): live handles to state/runtime/vehicle/economy/
  weather/daynight/chunks/pickups for console testing.
- `?fakeaway=SECONDS` (DEV only): simulate returning after time away.
