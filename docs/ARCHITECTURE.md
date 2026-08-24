# Everroad — Architecture Reference

The full technical reference for Everroad. This document is pull-context: it is
not loaded into any session automatically. Cite the sections a task touches and
read those before delegating or implementing.

## Table of Contents

1. [Project Philosophy](#1-project-philosophy)
2. [Complete Feature Set](#2-complete-feature-set)
3. [Technical Architecture](#3-technical-architecture)
4. [Data Flow](#4-data-flow)
5. [World & Rendering](#5-world--rendering)
6. [Vehicle, Input & Camera](#6-vehicle-input--camera)
7. [Pickups & Style Play](#7-pickups--style-play)
8. [Economy](#8-economy)
9. [Achievements](#9-achievements)
10. [Audio](#10-audio)
11. [UI Overlay](#11-ui-overlay)
12. [Save & Persistence](#12-save--persistence)
13. [Contract Reference](#13-contract-reference)
14. [Performance Budgets](#14-performance-budgets)
15. [Quick Reference](#15-quick-reference)

---

## 1. Project Philosophy

Everroad is an idle infinite driving game: a car cruises a procedurally
generated country highway through blended painted biomes, forever, in a browser
tab, with no backend and no external assets.

**There is no fail state.** The car drives itself. Every mechanic — pickups,
drifting, near-misses, the combo multiplier — makes the drive *faster*, never
survivable-or-not. The consequence in code is that no subsystem may throw into
the frame loop or leave the player stuck; audio failure, save corruption, and
WebGL context loss all degrade to a still-playable drive.

**The drive is the product.** The scene is the interface; the UI is an overlay
that stays out of the way. `#ui-root` is transparent to pointer events by
default and panels are summoned by single keys. Anything that would occlude the
road permanently does not ship.

**Everything is procedural.** The road, terrain, scenery, car meshes, sky, and
the entire soundtrack are synthesized at runtime. There are no textures, models,
or audio files in the repository. This is what keeps the bundle small and the
world genuinely infinite, and it is the reason `src/audio/` is oscillator graphs
rather than sample playback.

**Idle time is real time.** Progress accrues while the tab is closed, at a
tuned fraction of the live rate. The economy is therefore a pure function of
state and elapsed time — no dependency on frames having actually been rendered.

**Pure logic stays pure.** `game/`, `save/`, and `audio/` never touch the DOM or
Three.js; `ui/` never touches Three.js. This boundary is what makes the
economy, progression, and persistence unit-testable, and it is the single
convention whose erosion would cost the most to recover.

**Cozy, not punishing.** Pacing targets a medium grind: first car in 5–8
minutes, first prestige around half an hour, later tiers stretching to days.
The tuning behind those targets is simulated, not guessed — see
[§8](#8-economy) and docs/ECONOMY.md.

---

## 2. Complete Feature Set

Everything below marked **shipped** exists in `main` and is playable. Items
marked **post-MVP** are deliberately out of scope: their absence gets logged as
an issue when it actually hurts, not built speculatively.

### 2.1 Driving — shipped

- Infinite procedurally generated two-lane highway with curvature and elevation.
- Autopilot that cruises the right lane at 94% of the car's stated top speed.
- Manual steering (WASD / arrows) that engages on first input and hands back to
  autopilot ~4 seconds after the last steer (`HOLD_TIMEOUT`, `src/engine/input.ts`).
- Drift (hold Shift while steering at speed) with a physics-lite lateral slide.
- Near-miss detection against roadside obstacles.
- Speed clamped to the car's stated limit; W/S nudge within that band.

### 2.2 World — shipped

- Eight biomes on a rotating 2.7 km cycle with 520 m crossfade zones
  (`BIOME_LEN`, `BLEND_LEN`).
- Day/night cycle on a ~545-second period with elongated dawn and sunset.
- Weather state machine: clear, rain, fog, leaves/petals, aurora (night-only).
- Instanced scenery — trees, rocks, flowers, hay bales, fences, props — mixed
  per biome from the blend function.
- Gradient sky dome, sun disc, stars, aurora ribbons.
- Post-processing stack: god rays, bloom, vignette, SMAA.
- Floating-origin rebase so precision never degrades.

### 2.3 Progression — shipped

- Three currencies: coins, Horizon Tokens, relics.
- 12 cars across 7 tiers, each with a distinct procedural low-poly build.
- 5 per-car parts (engine, tuning, tires, magnet, chime) that reset on prestige.
- 8 permanent Horizon shop upgrades bought with tokens.
- Prestige ("Begin a New Journey") with a sublinear token formula and a rising
  mile gate.
- 127 achievements across 8 categories, with coin and token bounties.
- Full offline progress, capped at 14 days (`MAX_OFFLINE_SEC`).

### 2.4 Presentation — shipped

- Generative Web Audio soundtrack: biome-keyed pad chords, wind chimes,
  engine bed, wind, birds, crickets, rain, thunder, aurora shimmer, and UI
  one-shots.
- Glassy overlay HUD and six panels, retinted per biome.
- Toasts, biome-change banner, offline-summary modal, prestige flash.
- Save export/import as `EVR1.`-prefixed base64 codes.

### 2.5 Post-MVP — explicitly not built

- Any server, account, leaderboard, or cloud save.
- Mobile touch controls (the game renders on small screens; it is not driven
  on them).
- Additional biomes, cars, or achievement ladders beyond the shipped catalogs.
- Traffic, collisions, or any obstacle the player can hit.
- Localization.
- Sample-based audio or imported 3D models — these would break the zero-asset
  stance the whole architecture rests on.

---

## 3. Technical Architecture

### 3.1 Stack

TypeScript (strict) on Vite 6, Three.js r185, pmndrs `postprocessing` for the
effect composer, Web Audio for everything audible, `localStorage` for
persistence. No backend, no runtime dependency beyond those two packages.

### 3.2 Repository layout

```
src/
  main.ts              Bootstrap + game loop + integration      (core)
  types.ts             ALL shared contracts — single source     (core, frozen API)
  events.ts            Typed event bus                          (core)
  state.ts             Default state/runtime factories          (core)
  style.css            Base styles, CSS tokens, loading screen  (core)

  engine/
    input.ts           Keyboard state, active-mode detection
    daynight.ts        Time-of-day cycle -> phase, sun params

  world/               All Three.js scene code
    materials.ts       Toon ramps, painterly materials, noise + RNG helpers
    roadPath.ts        Infinite procedural road curve
    chunks.ts          Chunk manager: road mesh, terrain ribbons, pooling
    scenery.ts         Instanced trees/rocks/flowers/props per biome
    biomes.ts          Biome visual definitions + blend sampling
    sky.ts             Gradient sky dome, sun disc, stars, aurora
    weather.ts         Weather state machine + particles
    car.ts             Procedural car mesh builder (from CarStyle)
    vehicle.ts         Car controller: autopilot, steering, drift
    camera.ts          Chase camera rig
    pickups.ts         Coins/relics, magnet, near-miss detection
    postfx.ts          EffectComposer: god rays, bloom, vignette, SMAA

  game/
    economy/           pure logic, no DOM/Three
      cars.ts          CarDef catalog (12 cars)
      upgrades.ts      UpgradeDef + GlobalUpgradeDef catalogs
      economy.ts       Rates, tick, purchases, prestige math, offline rate
    achievements/      pure logic
      definitions.ts   127 AchievementDef entries
      tracker.ts       Batched condition checking, reward granting

  audio/               Web Audio, no DOM
    audio.ts           createAudioEngine(): AudioEngine
    palettes.ts        Per-biome key/mode data
    music.ts           Pad chords, phase shaping, chimes
    engineSound.ts     Engine rumble bed + drift layer
    nature.ts          Wind, birds, crickets, rain, thunder, aurora
    sfx.ts             One-shots
    helpers.ts         Noise buffers, ramps, midi->Hz, RNG

  save/
    save.ts            load/save/export/import/migrate/offline calc

  ui/                  DOM only, reads state, calls UIActions
    ui.ts              initUI(deps: UIDeps)
    hud.ts             Corner HUD + its rAF loop
    panels.ts          PanelManager lifecycle
    panel*.ts          One module per panel
    effects.ts         Toasts, banner, modal, prestige flash
    dom.ts             Change-detecting DOM helpers
    icons.ts           Emoji maps
    ui.css             Overlay styles
```

### 3.3 Dependency shape

```
                         ┌──────────────┐
                         │  src/types.ts│  every module imports from here
                         └──────┬───────┘
                                │
     ┌──────────────┬───────────┼───────────┬──────────────┐
     ▼              ▼           ▼           ▼              ▼
 ┌────────┐   ┌──────────┐ ┌────────┐  ┌────────┐    ┌────────┐
 │ world/ │   │ engine/  │ │ game/  │  │ audio/ │    │  ui/   │
 │ engine │   │  input   │ │  pure  │  │  pure  │    │DOM only│
 │ Three  │   │  clock   │ │ logic  │  │ WebAudio│   │        │
 └───┬────┘   └────┬─────┘ └───┬────┘  └───┬────┘    └───┬────┘
     │             │           │           │             │
     └─────────────┴─────┬─────┴───────────┴─────────────┘
                         ▼
                   ┌───────────┐        ┌────────────┐
                   │  main.ts  │◀──────▶│ events.ts  │
                   │ frame loop│        │  EventBus  │
                   └─────┬─────┘        └────────────┘
                         ▼
                   ┌───────────┐
                   │  save/    │  localStorage
                   └───────────┘
```

`main.ts` is the only module that knows about all of them. Nothing else reaches
across a boundary.

### 3.4 Hard boundaries

These are enforced by review, not by tooling, and they are the most valuable
convention in the codebase:

- Every module imports shared types from `src/types.ts` only, plus files inside
  its own directory. A shared type declared anywhere else forks the contract.
- `game/`, `save/`, and `audio/` never reference `document`, `window` (beyond
  Web Audio construction), or Three.js. This is what makes them testable.
- `ui/` never imports Three.js. It reads `state` and `runtime` as live objects
  and mutates them only through `UIActions`.
- `world/` and `engine/` never mutate currencies. They assemble an
  `EconomyContext` for the tick and hand it to `economy.applyTick`, which is the
  only writer of `state.currencies` during play.
- Cross-cutting notifications ride the typed `EventBus` in `src/events.ts`.
  There are no direct module-to-module callbacks for gameplay events.

---

## 4. Data Flow

### 4.1 Boot

```
index.html → main.ts
  loadGame()                      localStorage -> GameState | null
  ?? defaultState()               fresh save
  migrate(state)                  version < SAVE_VERSION
  offlineSeconds(state)           clamped to MAX_OFFLINE_SEC (14 days)
  economy.idleRate(state)         coins/sec at the neutral baseline
  grant offline coins             bus.emit('offlineSummary', {seconds, coins})
  build scene                     renderer, RoadPath, ChunkManager, Sky,
                                  Weather, Pickups, Vehicle, ChaseCamera, PostFX
  initUI(deps)                    HUD + panels mount over the canvas
  first user gesture → audio.start()
  requestAnimationFrame loop
  loading-screen.done             fades out over 1.2 s
```

### 4.2 The frame loop (`main.ts`)

```
requestAnimationFrame:
  dt = clamp(now - last)              tab-throttle guard; dt never spikes
  input.update()                   -> steering axis, active mode, drift flag
  vehicle.update(dt)               -> advances s, lateralOffset, speed, drift
  daynight.update(dt)              -> timeOfDay, phase, sun position + color
  weather.update(dt)               -> transitions (8 s fades), particles
  chunks.update(carS)              -> generate ahead, recycle behind
  pickups.update(dt)               -> collection, magnet, near-miss, combo
  economy.applyTick(state, ctx)    -> coinsEarned; the only currency writer
  achievements.check(...)          -> every ~1 s, batched; emits 'achievement'
  audio.update(mood)               -> only touches params that changed
  camera.update(dt)
  postfx.render(dt)
  save.autosave                    -> every 5 s
```

`dt` is clamped so a backgrounded tab that returns after minutes does not
teleport the car or grant a burst of coins — that time is credited through the
offline path instead.

### 4.3 Earning a coin

```
player steers → input.isActive = true
  pickups.update() detects a coin within magnet radius
    combo += gain (capped by tires level)
    comboTimer = duration (5 s + momentum levels)
    bus.emit('pickup', {kind:'coin', value})
  economy.applyTick receives EconomyContext {milesDelta, isActive, combo,
                                             biomeId, timePhase, weatherId}
    rate = 60 * car.coinMult * (1+0.08*tuning) * (1+0.10*horizonFlow) * situational
    earned = milesDelta * rate * (isActive ? combo : 1)
    state.currencies.coins += earned
    state.stats.lifetimeCoins += earned
  runtime.coinRate updated for the HUD
  ui/hud.ts rAF loop sees the changed string and writes it
```

### 4.4 Prestige

```
UI: getPrestigePreview() → {tokenGain, milesRequired, canPrestige}
user double-confirms within 3 s → actions.prestige()
  economy.prestige(state)
    tokens = max(1, floor((journeyMiles/25)^0.85 * (1 + 0.10*tokenMagnet)))
    currencies.tokens += tokens
    stats.prestigeCount++, stats.totalTokensEarned += tokens
    journeyMiles = 0
    coins = headStart value
    upgrades = {}                  every per-car part level resets
    (cars, relics, tokens, globals, achievements, lifetime stats survive)
  bus.emit('prestige', {tokensGained})
  ui/effects.ts paints the radial flash; audio.onPrestige() swells
  saveGame(state)
```

---

## 5. World & Rendering

### 5.1 The road curve (`roadPath.ts`)

The road is a 1-D parametric curve: `s → (position, tangent, normal)`. It is
built by integrating a smoothly varying curvature and elevation signal made of
seeded sums of sines (`sineNoise` in `materials.ts`), sampled every `DS = 2`
meters and cached in a ring buffer that extends incrementally as the car
advances. The road is `ROAD_HALF_WIDTH = 4.6` m to a side (~9.2 m total: two
lanes plus shoulders), and the right-lane center that autopilot tracks sits at
`LANE_OFFSET = 2.1`.

The car does not live in world space. It lives at `(s, lateralOffset)`, and its
transform is derived from the curve every frame. Anything positional — scenery
placement, pickup spawning, obstacle checks, chunk bounds — derives from `s`
too. **Caching an absolute world position across frames is the standing bug in
this subsystem**, because of the rebase below.

The lateral normal is the curve's right vector. Getting its sign wrong inverts
steering; this has been fixed once already (commit `2a3856d`) and is worth
re-deriving rather than copying when new code needs it.

### 5.2 Floating origin

When the car's world position exceeds roughly 2 km from the origin, the entire
scene rebases: the offset is subtracted from every persistent object. Float
precision therefore never degrades, however long the session runs. Consequences
for any new code:

- Positions cached across frames become wrong after a rebase.
- Distances and directions are safe; absolute coordinates are not.
- Anything that persists a world position must either re-derive it from `s` or
  participate in the rebase.

### 5.3 Chunks (`chunks.ts`)

`CHUNK_LEN = 60` m, with `AHEAD = 22` chunks generated ahead of the car (~1.3
km) and `BEHIND = 3` retained, so roughly 25–28 chunks are alive at once. Each
chunk owns a road strip, a terrain ribbon, and one merged scenery mesh. Chunks
are allocated on entry and disposed on exit — `update` builds any chunk in
`[cur - BEHIND, cur + AHEAD]` that is not in the map, then removes and
`dispose()`s the geometries of every chunk outside it. There is no chunk pool;
the geometry buffers are rebuilt per chunk. A perf regression here looks like a
build spike at a chunk boundary, or geometries surviving the cull (see #5, #1).

The road cross-section is a fixed column set (`ROAD_COLS`) running from dirt
shoulder through asphalt to the cream center line, and the terrain ribbon spans
`TER_COLS` from −165 m to +165 m with rows every `TER_ROW_STEP = 6` m. Terrain
height comes from `terrainHeight(path, s, lat)`, which blends the road's own
elevation into the surrounding land so the highway sits in the terrain rather
than on it.

Dash bleed at chunk seams and terrain winding after an axis flip have both been
bugs here (commits `2a3856d`, `ebbdbe9`). New geometry work in this file should
be checked at a seam, not mid-chunk.

### 5.4 Biomes (`biomes.ts`)

Eight biomes cycle in a fixed rotation with `BIOME_LEN = 2700` m per segment and
`BLEND_LEN = 520` m crossfade zones. `biomeAt(s)` returns a `BiomeSample`
(`{ id, nextId, blend }`), and every visual system samples that same function:

| Id | Name | Palette | Signature |
|----|------|---------|-----------|
| meadow | Emerald Meadows | greens, white wildflowers | rolling hills, lone oaks |
| farmland | Amber Farmland | wheat golds | hay bales, fences, windmills |
| sunflower | Sunflower Coast | yellow/teal | sunflower fields |
| autumn | **Emberwood** (hero) | deep oranges, reds | maples, falling leaves, biggest sunsets |
| pine | Mistpine Hills | teal/blue-green | tall pines, low fog |
| lavender | Lavender Reach | purples | lavender rows |
| cherry | Blossom Vale | pinks | cherry trees, petal drift |
| wetland | Dawnmarsh | soft blues/golds | reeds, water pools, mist |

`blendColor(s, pick)` and `blendNumber(s, pick)` interpolate any field of a
`BiomeVisual` across the crossfade, and `pickScenery(s, rand)` weights the
scenery mix the same way. Terrain vertex colors, fog color, sky tint, the UI
accent, and the audio palette all read from this one source, which is why
transitions feel continuous rather than staged. A new per-biome property is
added to `BiomeVisual` and consumed through `blendColor`/`blendNumber` — reading
`BIOMES[runtime.biomeId]` directly produces a visible pop at the boundary.

### 5.5 Sky and day/night (`sky.ts`, `engine/daynight.ts`)

`CYCLE_SEC = 545` — a full day in a bit over nine minutes, with dawn and sunset
phases stretched relative to their real proportion because they are the
game's best-looking states. `DayNight.update(dt)` produces `timeOfDay` (0..1,
0 = midnight), a `TimePhase` of `dawn | day | sunset | night`, and a
`SunSnapshot` carrying the sun's direction, color, and intensity.

The sky is a gradient dome shader with a sun disc, a star field that fades in at
night, and aurora ribbons that appear only during the aurora weather state. The
sun disc is also the god-ray source for the post-processing stack, so its screen
position and occlusion matter beyond its own appearance.

### 5.6 Weather (`weather.ts`)

A state machine over `clear | rain | fog | leaves | aurora` with `FADE_SEC = 8`
transitions. Aurora is night-only and rare. Leaves and petals draw their colors
from the current biome (`LEAF_DEFAULT` is the fallback). Weather feeds three
consumers: the particle systems, the audio mood, and the achievement tracker's
per-weather mile counters (`rainMiles`, `fogMiles`, `leafMiles`, `auroraMiles`).

Weather also multiplies earnings — aurora at ×1.50 is the largest situational
modifier in the game, which is deliberate: the rarest, prettiest weather is also
the most profitable, so noticing it is rewarded.

### 5.7 Scenery (`scenery.ts`)

Every scenery kind is a `Proto` — shared vertex/normal/color arrays built once.
Chunks do not instance these: `ChunkManager.buildScenery` CPU-bakes every
placement into a single merged `BufferGeometry` per chunk, transforming the
proto's vertices by the placement matrix and writing per-vertex colors. The
whole chunk's scenery is therefore one `THREE.Mesh` sharing the chunk material,
which keeps the draw call count flat at the cost of a per-chunk bake. Placement
is seeded from `s` so a given stretch of road always regenerates identically.
Painterly variation comes from `pickTint` on the baked vertex colors rather than
from distinct materials.

Adding a scenery kind means: a new `SceneryKind` member, a `getProto` case, a
weight in the relevant `BiomeVisual` entries, and — if it should count for
near-misses — registration as an `Obstacle` in `chunks.ts`.

### 5.8 Materials and post-processing (`materials.ts`, `postfx.ts`)

`toonRamp()` builds the 3-step `DataTexture` every toon material samples;
`toonMat(color)` and `vertexToonMat()` are the two constructors used across the
world. The painterly look is the sum of: 3-step toon shading, saturated pastel
palettes, per-instance vertex-color jitter, `FogExp2` tinted from the biome
blend, the gradient sky, and the effect stack.

`PostFX` composes god rays (pmndrs `GodRaysEffect` on the sun disc), bloom,
vignette, and SMAA. The quality setting (`low | medium | high`) scales this
stack; `low` is the escape hatch for weak GPUs and must remain genuinely
cheaper, not merely dimmer.

---

## 6. Vehicle, Input & Camera

### 6.1 Input (`engine/input.ts`)

Tracks raw key state and derives two things the rest of the game cares about:
the steering axis, and whether the player is *active*. Any steer input sets
active; `HOLD_TIMEOUT = 4` seconds without one hands control back to autopilot.
Active mode is what gates the combo multiplier, so this flag is economically
load-bearing, not just a control detail.

Panel keys are consumed by the UI, which sets `document.body.dataset.panel` and
emits `uiPanelChange`; the engine dims gameplay input while a panel is open.

### 6.2 Vehicle (`world/vehicle.ts`)

Physics-lite. `MPH_TO_MPS = 0.44704` converts the stated speeds; lateral offset
is clamped to `MAX_LATERAL = 6.6` m, slightly wider than the road so the car can
run onto the shoulder without leaving the world.

- **Autopilot** steers toward `LANE_OFFSET` (right lane) and cruises at 94% of
  the car's effective top speed.
- **Manual** steering moves lateral offset directly, eased.
- **Drift** engages with Shift while steering above a speed threshold: the car
  yaws away from its travel direction and slides, feeding `driftMiles`,
  `driftCount`, and the combo.

Effective speed is `(baseSpeed + 2 × engineLevel) × (1 + 0.05 × overdriveLevel)`,
and the car never exceeds its stated limit (commit `6fb1a21`).

### 6.3 Car meshes (`world/car.ts`)

`buildCar(style: CarStyle) → CarRig` constructs a low-poly car from a body type
and a palette — no models are loaded. Body types span compact, sedan, wagon,
pickup, van, classic, muscle, sports, super, and hover. `animateCar` spins the
wheels against ground speed and adds body roll; `hoverBob` is the Auroracraft's
idle float. Shared constants: `GLASS`, `TIRE`, `HUB`.

Swapping cars rebuilds the rig. Anything holding a reference into the old rig
(camera target, exhaust emitters, audio position) has to be re-pointed on
`carSelected`.

### 6.4 Camera (`world/camera.ts`)

`ChaseCamera` is a damped follow rig behind and above the car, with true-yaw
orbiting (`rotation.y` set directly rather than through Euler clamping — the
Euler approach was a bug, commit `2a3856d`). There is deliberately no idle sway.
Camera damping is `dt`-driven, so it stays stable through frame-rate changes.

---

## 7. Pickups & Style Play

`world/pickups.ts` owns coins, relics, the magnet, and near-miss detection, with
`COIN_CAP = 160` live coin instances.

**Coins** spawn as lines and arcs along the road ahead, biased toward the lanes
so weaving collects them. A coin is worth roughly two seconds of neutral
cruising income scaled by the current combo (minimum 1), so pickup value tracks
the player's entire multiplier stack without separate tuning.

**Relics** are rare, biome-flavored collectibles at a base rate of 0.008 per
mile, scaled by chime and keen-eye levels. They are the only currency the player
hunts rather than accrues.

**The magnet** pulls pickups within `2.5 + 0.7 × magnetLevel` meters.

**Near-misses** fire when the car passes close to a registered `Obstacle` —
hay bales, fences, logs — emitting `nearMiss` and bumping the combo.

**The combo** rises `0.25/sec + 0.03 × tiresLevel` while style actions land,
caps at `min(8, 2 + 0.5 × tiresLevel)`, and decays after `5 + momentumLevel`
seconds. It multiplies earnings only while `isActive` — this idle-gating is what
keeps active play worth roughly 2.2× idle play, and it has been the source of
more than one bug (commits `2b03e31`, `ebbdbe9`). Any new combo source needs the
same gate.

---

## 8. Economy

Implementation: `src/game/economy/`. Full tuning tables, the derivation of every
constant, and the simulated pacing timeline live in **docs/ECONOMY.md** — that
document and the code are meant to move together, and a change to one without
the other is a defect.

### 8.1 Currencies

| Currency | Earned by | Spent on |
|----------|-----------|----------|
| Coins | Every mile driven, and road pickups | Coin cars, per-car parts |
| Horizon Tokens | Prestige | Horizon shop globals, the Auroracraft |
| Relics | Rare roadside spawns (~0.008/mile base) | Petal Roadster (12), Marsh Wraith (30) |

### 8.2 Core formulas

```
BASE_COINS_PER_MILE = 60

carSpeed (mph)   = (baseSpeed + 2 * engineLevel) * (1 + 0.05 * overdriveLevel)

coinRate/mile    = 60
                 * car.coinMult
                 * (1 + 0.08 * tuningLevel)
                 * (1 + 0.10 * horizonFlowLevel)
                 * situational

situational      = sunset x1.15 | dawn x1.05
                 * autumn (Emberwood) x1.10
                 * aurora x1.50 | leaves x1.05

tick earnings    = milesDelta * coinRate/mile * (isActive ? combo : 1)

offline fraction = 0.40 + 0.08 * longHaulLevel      (L10 => 120%)
idle coins/sec   = carSpeed/3600 * coinRate(neutral) * offline fraction
                   (neutral = meadow / day / clear)

pickup value     = ceil(2 sec of neutral cruising income * combo), min 1
relic chance     = 0.008/mile * (1 + 0.15*chime) * (1 + 0.15*keenEye)
magnet radius    = 2.5 m + 0.7 * magnetLevel
combo cap        = min(8, 2 + 0.5 * tiresLevel)
combo gain       = 0.25/sec + 0.03 * tiresLevel
combo duration   = 5 s + 1 s * momentumLevel

milesRequired    = 25 * 1.35^prestigeCount
tokens           = max(1, floor((journeyMiles / 25)^0.85 * (1 + 0.10*tokenMagnet)))
```

The starter reference point: 42 mph is 0.01167 miles/sec, giving **0.70
coins/sec** live idle on a fresh save, and 0.28 coins/sec offline at long-haul 0.

### 8.3 Car catalog

| Id | Name | Tier | Cost | Speed | coinMult | Body |
|----|------|------|------|-------|----------|------|
| rusty-hatch | Rusty Hatchback | 0 | free | 42 | 1.0 | compact |
| commuter | Commuter | 1 | 400 c | 52 | 1.25 | sedan |
| homestead-wagon | Homestead Wagon | 1 | 700 c | 55 | 1.45 | wagon |
| orchard-pickup | Orchard Pickup | 2 | 3,500 c | 62 | 1.9 | pickup |
| wanderer-van | Wanderer Van | 2 | 6,000 c | 66 | 2.2 | van |
| sunday-classic | Sunday Classic | 3 | 28,000 c | 74 | 3.0 | classic |
| ember-gt | Ember GT | 3 | 45,000 c | 80 | 3.5 | muscle |
| crimson-comet | Crimson Comet | 4 | 240,000 c | 92 | 4.6 | sports |
| petal-roadster | Petal Roadster | 4 | 12 relics | 88 | 5.2 | classic |
| horizon-s | Horizon S | 5 | 1,800,000 c | 112 | 7.0 | super |
| marsh-wraith | Marsh Wraith | 5 | 30 relics | 105 | 8.0 | sports |
| auroracraft | Auroracraft | 6 | 200 tokens | 150 | 12.0 | hover |

Coin-tier cost growth runs ×7.5–8.75 per tier. Relic cars are sidegrades-plus:
higher `coinMult`, slightly lower speed, so relic hunting always pays.

### 8.4 Per-car parts (reset on prestige)

Next-level cost = `ceil(baseCost * growth^level * (1 - 0.02 * quickSpool))`.

| Part | Effect / level | Max | Base | Growth |
|------|----------------|-----|------|--------|
| engine | +2 mph | 25 | 15 | 1.55 |
| tuning | +8% coins | 25 | 20 | 1.60 |
| tires | +0.5 combo cap, +0.03 gain | 15 | 40 | 1.65 |
| magnet | +0.7 m radius | 10 | 60 | 1.70 |
| chime | +15% relic chance | 10 | 80 | 1.75 |

### 8.5 Horizon shop (permanent, tokens)

Next-level cost = `ceil(baseCost * growth^level)`.

| Id | Effect / level | Max | Base | Growth |
|----|----------------|-----|------|--------|
| horizon-flow | +10% all coin earnings | 50 | 1 | 1.6 |
| long-haul | +8% offline rate | 10 | 2 | 1.6 |
| momentum | +1 s combo duration | 10 | 2 | 1.6 |
| head-start | start with `250 * L * 2^(L-1)` coins | 8 | 1 | 1.7 |
| token-magnet | +10% prestige token gain | 20 | 3 | 1.6 |
| keen-eye | +15% relic spot chance | 15 | 2 | 1.6 |
| overdrive | +5% top speed | 20 | 3 | 1.65 |
| quick-spool | −2% per-car upgrade costs | 15 | 2 | 1.6 |

### 8.6 Prestige

Resets journey miles to 0, coins to the head-start value, and **every per-car
part level**. Keeps cars, relics, tokens, globals, achievements, and lifetime
stats. Mile gates run 25 / 33.8 / 45.6 / 61.5 / 83 / 112…, and the 0.85 exponent
makes overshooting sublinear so prestiging early and often beats camping a run.

### 8.7 Pacing targets

Simulated against the real module at 1-second ticks: first car at ~6–7 minutes
for a saving player (~16 min pure idle), first prestige gate at ~26 minutes with
the natural stopping point around 31–40, active play at ~2.2× idle, three cars
in the first hour. These are the numbers a tuning change is measured against.

---

## 9. Achievements

Implementation: `src/game/achievements/`. The complete list is in
**docs/ACHIEVEMENTS.md**, generated from `definitions.ts`, which is the source
of truth.

127 achievements across 8 categories: distance (20), wealth (16), garage (17),
skill (21), explorer (23), dedication (12), prestige (8), secret (10). Each
`AchievementDef` carries an id, category, icon, name, description, a predicate
over `GameState`, an optional reward, and a `secret` flag.

`tracker.ts` checks conditions in a batch roughly once per second rather than
per frame, and emits a single `achievement` event carrying every def that
unlocked in that pass — so a burst of simultaneous unlocks produces one event
and a stack of toasts, not one event each. Rewards are granted once at unlock;
coin bounties count toward lifetime coins and token bounties appear only on rare
late-game and prestige milestones. Secret achievements render as `???` until
earned.

Adding an achievement is a `definitions.ts` entry plus a regenerated
docs/ACHIEVEMENTS.md. If the predicate needs a stat that does not exist, add it
to `GameStats` in `types.ts` and to `defaultStats()`, and handle its absence in
the save migration — an old save will not have the field.

The standing risk in this subsystem is a condition that can never fire (a stat
that stopped being written, or a threshold above any reachable value). That is
one of the classes `/deep-audit` looks for.

---

## 10. Audio

Implementation: `src/audio/`, entry `createAudioEngine(): AudioEngine`. Full
node graph, per-layer synthesis detail, and scheduling rules are in
**docs/AUDIO.md**.

Fully generative: no audio files, no DOM, no timers. Every sound is oscillators
and noise buffers, and every event — chord change, bird chirp, chime — is
scheduled against `ctx.currentTime` inside the per-frame `update()` call. There
is no `setInterval` or `setTimeout` anywhere in the module.

### 10.1 Bus layout

Two buses into a master compressor (threshold −20 dB, ratio 3:1):

- **Music bus** — pad chords (per chord tone: a triangle detuned flat plus a
  sine detuned sharp, plus a sub sine an octave below the root, through a
  lowpass breathing on a 0.06 Hz LFO), wind chimes with a feedback delay, and
  the aurora shimmer.
- **SFX bus** — engine rumble (brown noise through a lowpass that tracks
  speed), the drift tire layer, wind, rain, birds, crickets, thunder, and all
  one-shots through an echo send.

Turning SFX down quiets the world; turning music down leaves just the drive.

### 10.2 Lifecycle and safety

- No `AudioContext` exists until `start()`, which `main.ts` calls on the first
  user gesture. Before that, every method is a silent no-op. `start()` is
  idempotent and wrapped in try/catch: if construction fails, the engine flags
  itself failed and every later call no-ops. **An audio failure can never crash
  the game** — this is the property to preserve when touching this module.
- `setEnabled(false)` ramps master gain to 0 over ~0.5 s, then suspends the
  context once the tail has faded. `setEnabled(true)` resumes and ramps back.
- Volumes are squared for a perceptual curve; values set before `start()` are
  stored and applied at build time.
- `update(mood)` compares against the last applied mood and touches AudioParams
  only on change — speed only when it moved more than 0.4 mph.

Chords advance every 20–30 seconds with an ~8 s release overlapping a ~6 s
attack, so there is never a hard cut. A biome change is just a chord change into
the new palette plus a filter-brightness ramp, which is why biome transitions
sound continuous.

---

## 11. UI Overlay

Implementation: `src/ui/`, entry `initUI(deps: UIDeps)`. Full panel-by-panel
specification is in **docs/UI.md**; token values and component specs are in
**docs/DESIGN_SYSTEM.md**.

Plain TypeScript and DOM inside `#ui-root`, which is `position: fixed; inset: 0;
pointer-events: none`. Interactive surfaces opt back in with `pointer-events:
auto`. No framework, no Three.js import.

### 11.1 HUD

| Corner | Contents |
|--------|----------|
| Top-left | Coins + `+X/s` rate; tokens and relics rows appear on first earn and never re-hide |
| Top-right | Biome name, time-of-day icon, weather icon when not clear, fps chip when enabled |
| Bottom-left | Speedometer, AUTO/MANUAL pill, DRIFT pill |
| Bottom-center | Combo meter (hidden at ×1) with a draining bar |
| Bottom-right | Journey odometer, lifetime miles, trophy progress |
| Top-center | Toast stack, then the biome banner, modal, and prestige-flash layers |

The HUD runs its own rAF loop that re-reads `deps.state` and `deps.runtime` as
live objects each frame and writes to the DOM only when the rendered string or
class actually changed. The change-detecting helpers in `dom.ts` exist for
this; bypassing them puts layout thrash inside the renderer's frame budget.

### 11.2 Panels

One center glass card at a time, managed by `PanelManager`: garage (G),
upgrades (U), trophies (T), prestige (P), settings (Esc), help (H). Panels with
live numbers return an updater from `render()` that the manager runs every 250
ms without rebuilding the DOM. `purchase` and `carSelected` re-render the open
panel while preserving scroll position. The trophies grid is built once and
cached; `achievement` events patch unlock states in place, even while closed.

Keys are ignored while a text field has focus and while Ctrl/Cmd/Alt are held.
Every open and close sets `document.body.dataset.panel` and emits
`uiPanelChange` so the engine can dim gameplay input.

### 11.3 Events consumed

| Event | Response |
|-------|----------|
| `achievement` | A toast per unlock; trophies grid patched in place |
| `toast` | Generic small toast |
| `pickup` (relic) | "Relic found!" toast |
| `offlineSummary` | Welcome-back modal: duration → coins |
| `prestige` | Radial flash + token toast |
| `biomeChange` | Area-title banner, ~2.6 s |
| `purchase`, `carSelected` | Re-render the open panel |

Toasts stack top-center, three visible with the rest queued, auto-dismissing
after 4.5 s.

---

## 12. Save & Persistence

Implementation: `src/save/save.ts`.

- **Key**: `localStorage["everroad-save-v1"]`, holding a JSON `GameState`.
- **Autosave**: every 5 seconds during play, and on tab close.
- **Export**: `EVR1.` + base64(JSON). `importSave` validates the prefix and the
  decoded shape and returns `null` on anything malformed — the UI shows an
  inline error rather than throwing.
- **Migration**: keyed off `state.version` against `SAVE_VERSION`. A migration
  fills fields that did not exist in the older shape; a missing field must
  resolve to its `defaultState()` value, never to `undefined` reaching the
  economy. A migration that back-fills a *per-journey* counter seeds it from the
  lifetime counter, not from zero, so an existing save is not handed progress it
  never earned (`journeyActiveMiles` is the worked example).
- **Forward versions**: a save whose `version` exceeds `SAVE_VERSION` is refused,
  never downgraded — silently re-stamping it would drop fields this build does
  not know about. `importSave` returns `null` (the same channel as a malformed
  code, so the UI shows its inline error). `loadGame` returns `null` *and* copies
  the raw string to `localStorage["everroad-save-v1-future"]` first, because the
  5-second autosave would otherwise overwrite the newer save with a fresh
  `defaultState()` within seconds. `clearSave()` deliberately leaves that backup
  key in place.
- **Offline**: `offlineSeconds(state, nowMs)` clamps the gap to
  `MAX_OFFLINE_SEC` (14 days). Coins are granted at the idle rate for that
  duration and reported through the `offlineSummary` event.

This module carries the highest blast radius in the codebase: a bug here
destroys a player's progress irrecoverably, because there is no server copy.
Save tests sit near full coverage for that reason, and every new `GameState`
field needs a migration path in the same change.

---

## 13. Contract Reference

`src/types.ts` is the frozen API surface between modules. Every entry below is
imported by at least two directories.

### 13.1 Core value types

| Type | Shape |
|------|-------|
| `CurrencyBalances` | coins, tokens, relics |
| `CurrencyId` | `keyof CurrencyBalances` |
| `TimePhase` | `dawn \| day \| sunset \| night` |
| `WeatherId` | `clear \| rain \| fog \| leaves \| aurora` |
| `BiomeId` | the eight biome ids; `BIOME_ORDER` and `BIOME_NAMES` accompany it |
| `CarBodyType` | compact, sedan, wagon, pickup, van, classic, muscle, sports, super, hover |
| `CarStyle` | body type + palette, consumed by `buildCar` |
| `CarDef` | id, name, tier, cost, baseSpeed, coinMult, style, flavor |
| `UpgradeKind` | engine, tuning, tires, magnet, chime |
| `UpgradeDef` / `GlobalUpgradeDef` | catalog entries with base cost, growth, max |
| `AchievementCategory` | distance, wealth, garage, skill, explorer, dedication, prestige, secret |
| `AchievementDef` | id, category, icon, name, description, predicate, reward, secret |

### 13.2 State

`GameState` (persisted): `version`, `currencies`, `stats`, `currentCarId`,
`ownedCars`, `upgrades` (carId → upgradeId → level), `globalUpgrades`,
`achievements`, `settings`, `lastSaveTime`, `createdTime`.

`GameStats` (28 counters, all-time unless noted): lifetime and journey miles,
lifetime coins, pickups, relics, drift count and miles, near-misses, best combo,
active/idle miles, per-phase miles (night/sunset/dawn), per-weather miles
(rain/fog/leaf/aurora), biomes visited, weather seen, upgrades purchased,
prestige count, tokens earned, play time, offline coins, top speed, sessions.

`GameSettings`: `audioEnabled`, `musicVolume`, `sfxVolume`, `quality`,
`showFps`.

`RuntimeState` (not persisted): `speedMph`, `isActive`, `isDrifting`, `combo`,
`comboTimer`, `biomeId`, `nextBiomeId`, `biomeBlend`, `timeOfDay`, `timePhase`,
`weatherId`, `coinRate`, `fps`, `paused`.

### 13.3 Module contracts

**Economy** — `EconomyContext { dtSec, milesDelta, isActive, combo, biomeId,
timePhase, weatherId }` in, `TickResult { coinsEarned }` out;
`PrestigePreview` for the panel.

**Event bus** — `GameEvents` declares fourteen typed events: `achievement`,
`pickup`, `purchase`, `carSelected`, `prestige`, `biomeChange`,
`weatherChange`, `phaseChange`, `offlineSummary`, `driftEnd`, `nearMiss`,
`toast`, `saveExported`, `uiPanelChange`. `EventBus.on` returns its own
unsubscribe function; anything that subscribes and can be torn down must call
it.

**UI** — `UIDeps { state, runtime, catalogs, actions, bus }` and `UIActions`
(buy/select car, buy upgrade, buy global, cost getters, prestige preview and
commit, export/import/reset save, audio and quality setters, `getCarSpeed`).
Note that `UIActions` has no volume setters: the settings panel mutates
`state.settings.musicVolume` and `sfxVolume` directly and the audio engine reads
them live.

**Audio** — `AudioEngine` with `start`, `setEnabled`, volume setters,
`update(mood)`, and the five one-shot hooks (`onPickup`, `onAchievement`,
`onPurchase`, `onNearMiss`, `onPrestige`).

**Helpers** — `SAVE_VERSION`, `formatNumber` (compact K/M/B/T/Qa/Qi/Sx/Sp),
`formatDuration` (`45s` / `2m 5s` / `2h 14m` / `3d 4h`).

---

## 14. Performance Budgets

| Metric | Target | Notes |
|--------|--------|-------|
| Frame rate | 60 fps at `quality: high` on a 2020-class integrated GPU | The whole design assumes a steady frame; a dip is a bug, not a setting |
| Frame budget | ~16.6 ms, with the effect stack inside it | God rays plus bloom are the largest single cost |
| Per-frame allocation | Zero steady-state | Scratch vectors and colors are hoisted; pooling and instancing everywhere |
| Live chunks | 25–28 (~1.5 km visible) | `AHEAD = 22`, `BEHIND = 3`, `CHUNK_LEN = 60` |
| Live coin instances | ≤ 160 | `COIN_CAP` |
| Draw calls | Instanced per scenery kind per chunk, not per object | A per-object draw call in `scenery.ts` is a regression |
| Cold start to playable | Under ~3 s on a warm cache | Nothing is fetched; the loading screen covers scene construction |
| Bundle | Well under the 1500 kB Vite warning ceiling | Three.js dominates; a new dependency needs a reason |
| Audio nodes | Bounded — one-shots are constructed, played, and released | A leak here shows up as gradual CPU climb over a long session |
| localStorage write | Every 5 s, single JSON serialize | Growth in `GameState` is growth in this write |
| Offline computation | O(1) regardless of gap | Capped at 14 days; never a replay loop |

---

## 15. Quick Reference

### Commands

| Command | Does |
|---------|------|
| `npm run dev` | Vite dev server (the `.claude/launch.json` config pins port 5199) |
| `npm run typecheck` | `tsc --noEmit` — the lint gate |
| `npm test` | Vitest in watch mode |
| `npm run test:run` | Vitest once |
| `npm run verify` | typecheck + tests + build — the full gate |
| `npm run build` | typecheck + `vite build` |
| `npm run preview` | Serve the built bundle |
| `npm run format:check` | Prettier check over `src/**/*.{ts,css}` |

### Fixed decisions

| Decision | Value |
|----------|-------|
| Package manager | npm (`package-lock.json` is committed) |
| Node in CI | 22 |
| Dev port | 5199, strict |
| Save key | `everroad-save-v1`; export prefix `EVR1.` |
| Three.js | r185, with `@types/three` pinned to match |
| Backend | none, ever |
| External assets | none, ever — everything is procedural |
| Repository | `Troll-Phace/everroad`, default branch `main` |
| CI | `.github/workflows/ci.yml`; `.githooks/pre-push` mirrors it locally |

### Tuning constants at a glance

| Constant | Value | Home |
|----------|-------|------|
| `BASE_COINS_PER_MILE` | 60 | `game/economy/economy.ts` |
| `BIOME_LEN` / `BLEND_LEN` | 2700 m / 520 m | `world/biomes.ts` |
| `CHUNK_LEN` / `AHEAD` / `BEHIND` | 60 m / 22 / 3 | `world/chunks.ts` |
| `DS` / `ROAD_HALF_WIDTH` / `LANE_OFFSET` | 2 m / 4.6 m / 2.1 m | `world/roadPath.ts` |
| `CYCLE_SEC` | 545 s | `engine/daynight.ts` |
| `HOLD_TIMEOUT` | 4 s | `engine/input.ts` |
| `MAX_LATERAL` | 6.6 m | `world/vehicle.ts` |
| `FADE_SEC` | 8 s | `world/weather.ts` |
| `COIN_CAP` | 160 | `world/pickups.ts` |
| `MAX_OFFLINE_SEC` | 14 days | `save/save.ts` |
| `SAVE_VERSION` | 1 | `types.ts` |

### Companion documents

- docs/GDD.md — design intent and the player-facing loop
- docs/ECONOMY.md — every tuning table and the simulated pacing timeline
- docs/ACHIEVEMENTS.md — all 127 achievements
- docs/AUDIO.md — the full node graph and synthesis detail
- docs/UI.md — panel-by-panel overlay specification
- docs/DESIGN_SYSTEM.md — tokens, component specs, motion, accessibility
- docs/BUILDLOG.md — running build diary

*This document evolves with the implementation.*
