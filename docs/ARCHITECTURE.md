# Everroad — Architecture

## Module map & ownership

```
src/
  main.ts              Bootstrap + game loop + integration      (core)
  types.ts             ALL shared contracts — single source     (core, frozen API)
  events.ts            Typed event bus                          (core)
  state.ts             Default state/runtime factories          (core)
  style.css            Base styles + loading screen             (core)

  engine/
    input.ts           Keyboard state, active-mode detection    (core)
    daynight.ts        Time-of-day cycle -> phase, sun params   (core)

  world/               All Three.js scene code                  (core)
    materials.ts       Toon/painterly materials, palettes
    roadPath.ts        Infinite procedural road curve (curvature/elevation noise)
    chunks.ts          Chunk manager: road mesh, terrain ribbons, pooling
    scenery.ts         Instanced trees/rocks/flowers/props per biome
    biomes.ts          Biome visual definitions + blend sampling
    sky.ts             Gradient sky dome shader, sun disc, stars, aurora
    weather.ts         Weather state machine + particles (rain/leaves/petals)
    car.ts             Procedural car mesh builder (from CarStyle)
    vehicle.ts         Car controller: autopilot, steering, drift physics-lite
    camera.ts          Chase camera rig
    pickups.ts         Coins/relics spawning, magnet, near-miss detection
    postfx.ts          EffectComposer: god rays, bloom, vignette, SMAA

  game/
    economy/           (agent-built) pure logic, no DOM/Three
      cars.ts          CarDef catalog (12 cars)
      upgrades.ts      UpgradeDef + GlobalUpgradeDef catalogs
      economy.ts       Rates, tick, purchases, prestige math, offline rate
    achievements/      (agent-built) pure logic
      definitions.ts   100+ AchievementDef entries
      tracker.ts       Batched condition checking, reward granting

  audio/               (agent-built) Web Audio, no DOM
    audio.ts           createAudioEngine(): AudioEngine

  save/                (agent-built) pure logic
    save.ts            load/save/export/import/migrate/offline calc

  ui/                  (agent-built) DOM only, reads state, calls UIActions
    ui.ts              initUI(deps: UIDeps)
    ui.css             Glassy overlay styles
```

## Hard boundaries

- Everything imports types ONLY from `src/types.ts` (plus their own submodules).
- `game/`, `save/`, `audio/` never touch DOM or Three.js.
- `ui/` never touches Three.js; it mutates state only through `UIActions`.
- `world/` + `engine/` never mutate currencies directly — they produce an
  `EconomyContext` per tick and hand it to `economy.applyTick`.
- Cross-cutting notifications ride the typed `EventBus` (`src/events.ts`).

## The game loop (main.ts)

```
requestAnimationFrame:
  dt = clamp(now - last)
  input.update()                      -> steering, active mode
  vehicle.update(dt)                  -> moves car along roadPath, speed, drift state
  daynight.update(dt)                 -> timeOfDay, phase, sun position
  weather.update(dt)                  -> weather transitions, particles
  chunks.update(carS)                 -> generate/recycle road+terrain+scenery ahead
  pickups.update(dt)                  -> collection, near-miss, combo events
  economy.applyTick(state, ctx)       -> coins earned
  achievements.check (every ~1s)      -> unlock toasts
  audio.update(mood)
  camera.update(dt)
  postfx.render(dt)
  save.autosave (every 5s)
```

## Key technical decisions

- **Infinite road:** the road is a 1-D parametric curve `s -> (pos, tangent)` built by
  integrating a smoothly-varying curvature and elevation signal (seeded sums of sines).
  Generated incrementally in 60 m segments, cached in a ring buffer. The car lives at
  `(s, lateralOffset)`.
- **Floating origin:** when the car's world position exceeds ~2 km from origin, the
  whole scene rebases by subtracting the offset — avoids float precision jitter forever.
- **Chunk pooling:** ~28 chunks alive (≈1.7 km visible), each owning a road strip,
  terrain ribbon, and instanced scenery. Recycled behind -> ahead with new geometry.
- **Biome blending:** biome weights are a function of `s` (long crossfade zones).
  Scenery mix, terrain vertex colors, fog color, and sky tint all sample the same
  blend function, so transitions feel continuous.
- **Painterly look:** 3-step toon ramps + saturated pastel palettes + vertex-color
  jitter + FogExp2 + gradient sky + god rays (postprocessing `GodRaysEffect` on the
  sun disc) + bloom + vignette.
- **Offline progress:** `save.load()` compares `lastSaveTime` to now and asks economy
  for the idle coins/sec rate; grants coins + emits `offlineSummary`.

## Save format

`localStorage["everroad-save-v1"]` = JSON `GameState`. Export = base64(JSON) with a
`EVR1.` prefix. Migrations keyed off `state.version`.

## Docs

- `docs/GDD.md` — design
- `docs/ARCHITECTURE.md` — this file
- `docs/ECONOMY.md` — tuning tables (written by economy agent)
- `docs/ACHIEVEMENTS.md` — full achievement list (written by achievements agent)
- `docs/BUILDLOG.md` — running build diary
