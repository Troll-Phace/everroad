# EverRoad — Architecture Reference

The full technical reference for EverRoad. This document is pull-context: it is
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
16. [Desktop Packaging & Releases](#16-desktop-packaging--releases)

---

## 1. Project Philosophy

EverRoad is an idle infinite driving game: a car cruises a procedurally
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
  engine bed, wind, birds, crickets, rain, thunder, and UI
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

Release builds are additionally wrapped for the desktop by Electron, packaged
by `electron-builder`, and published to GitHub Releases. Both are build-time
devDependencies: nothing Electron-shaped is bundled into the web build, and the
game does not know which of the two it is running in beyond a single feature
check (§16). Development happens in the browser, unchanged.

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
    scenery.ts         Merged-bake trees/rocks/flowers/props per biome
    grass.ts           Instanced wind-animated ground cover, near band only
    biomes.ts          Biome visual definitions + blend sampling
    farLand.ts         Camera-anchored distant land past the ribbon's edge
    sky.ts             Gradient sky dome, sun disc, stars, aurora
    sunShadow.ts       Sun shadow rig: light placement, ortho box, night gate
    weather.ts         Weather state machine + particles
    car.ts             Procedural car mesh builder (from CarStyle)
    carPalette.ts      Fixed car tones shared by both car builders
    vehicle.ts         Car controller: autopilot, steering, drift
    camera.ts          Chase camera rig
    menuCamera.ts      Attract-mode cinematic shot director (main menu)
    pickups.ts         Coins/relics, magnet, near-miss detection
    postfx.ts          EffectComposer: god rays, bloom, vignette, SMAA

    models/            Handcrafted (Blender) replacements — opt-in per asset
      generated.ts     GENERATED quantised model data (npm run models)
      codec.ts         Decoder: base64 -> positions/normals/shade
      registry.ts      Lookup + the ?models=procedural override
      sceneryModel.ts  Encoded model -> Proto
      carModel.ts      Encoded model -> CarRig

  tools/
    modelViewer.ts     Dev-only A/B lookdev bench (/model-viewer.html)

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

  version/             Build identity — a leaf: imports nothing from the game
    version.ts         APP_VERSION / BUILD_COMMIT / BUILD_DATE, runtime(), buildLabel()
    desktop.ts         Typed window.everroad bridge; null in the browser
    changelog.generated.ts  GENERATED patch notes (npm run changelog)

  vite-env.d.ts        Ambient declarations for the Vite `define` constants

  ui/                  DOM only, reads state, calls UIActions
    ui.ts              initUI(deps: UIDeps)
    hud.ts             Corner HUD + its rAF loop
    panels.ts          PanelManager lifecycle
    panel*.ts          One module per panel
    effects.ts         Toasts, banner, modal, prestige flash
    dom.ts             Change-detecting DOM helpers
    icons.ts           Emoji maps
    ui.css             Overlay styles

tools/blender/         Blender-side model pipeline (see docs/MODELS.md)
  everroad_kit.py      Authoring kit recipes import
  everroad_export.py   Scene -> .evr.json
  build_models.py      Headless rebuild of every recipe
  smoke_test.py        Exporter regression test

assets/models/
  src/*.py             Model recipes — the source of truth
  *.evr.json           Exported intermediates, committed so CI needs no Blender

electron/              The desktop shell (§16). No game code lives here.
  main.cjs             Main process: window, CSP, navigation policy, IPC
  preload.cjs          contextBridge -> window.everroad, and nothing else

build/
  icon.png             1024x1024 app icon; electron-builder derives the rest
                       (drawn by scripts/build-icon.mjs)

release/               electron-builder output — git-ignored

scripts/
  build-models.mjs     .evr.json -> src/world/models/generated.ts
  lib/model-codec.mjs  Validator, budgets, encoder
  build-changelog.mjs  CHANGELOG.md -> src/version/changelog.generated.ts
  lib/changelog-parse.mjs  Changelog parser + the version/date validators
  lib/build-info.mjs   Build stamp shared by vite.config and vitest.config
  release-notes.mjs    One version's CHANGELOG section, for the Release body
  build-icon.mjs       Draws build/icon.png
  check-bundle-size.mjs
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
  Two shared leaves are the sanctioned exceptions, both of them dependency-free
  and importable from anywhere: `src/events.ts` (the typed `EventBus`) and
  `src/version/` (build identity and patch notes, §16.5). Both import nothing
  from the game, which is what keeps them from becoming a second `types.ts`.
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

The app boots into the **main menu**, not into play. Offline progress is *not*
granted at boot — it is granted when the player presses Continue (see below).

```
index.html → main.ts
  loadGame()                      localStorage -> GameState | null
  ?? defaultState()               fresh save
  migrate(state)                  version < SAVE_VERSION
  build scene                     renderer, RoadPath, ChunkManager, Sky,
                                  Weather, Pickups, Vehicle, ChaseCamera,
                                  MenuCamera, PostFX
  initUI(deps)                    menu + HUD + panels mount over the canvas
  enterMenu()                     appMode='menu'; seeds the attract scene
  requestAnimationFrame loop
  loading-screen.done             fades out over 1.2 s onto the menu
  first user gesture → audio.start()   (a menu button click is that gesture)
```

**Attract mode (`appMode === 'menu'`).** `enterMenu()` re-rolls the scene every
time it is entered: a random `CarDef` from the whole catalog (its `style` *and*
its `baseSpeed`, latched into `menuCruiseMph` so the showreel car drives at its
own speed rather than the player's), a random biome via `sForBiome`, and a
randomised time of day weighted toward flattering light. The world is seeded
before the first rendered frame, so the loading screen lifts onto the correct
biome rather than flashing the meadow.

The whole world runs — sim, chunks, sky, weather, audio, pickup animation — but
**nothing persistent moves**: the economy tick, achievement checks,
`updateSlowDrive`, the `dt > 0.5` idle-banking branch, every `state.stats` /
`state.currencies` write, autosave, and the `beforeunload` /
`visibilitychange` writes are all gated on `appMode === 'playing'`. `Pickups`
still updates so coins glint on the road, but its payout callbacks early-return.
`runtime.paused` rides with menu mode so scene-sampled secrets cannot unlock.

**Leaving and re-entering.**

```
startGame('continue')             grant offline coins, sessionCount += 1
startGame('new')                  clearSave(); newJourneyState(state.settings)
  seedWorldAt(START_S)            path/chunks/pickups reset, vehicle.resetTo
  chase.snapTo(vehicle)           no lerp in from the cinematic pose
  appMode='playing'               bus.emit('appModeChange')
quitToMenu()                      saveGame(state), then enterMenu()
```

Both are **synchronous** world resets. All transition timing belongs to the UI,
which fades to black, calls the action, and fades back in (§11).

**The offline window is measured to menu entry, not to now.** `quitToMenu()`
saves, which stamps `lastSaveTime`; if the grant measured to `Date.now()` the
player would be paid for time spent sitting on the title screen. `main.ts`
latches `menuEnteredMs` in `enterMenu()` and grants
`save.offlineSeconds(state, menuEnteredMs)`. Menu time is therefore neither
credited nor eaten — after a quit the gap is 0, and at boot it is the true
away time.

**Backwards teleport.** `RoadPath.pose()` reads a retained sample window, so
jumping from attract mode (s ≈ 20 km) back to `START_S` collapsed every lookup
onto `samples[0]`. `seedWorldAt(s)` re-seeds the path `RESEED_MARGIN` behind the
car and resets chunks and pickups, so the retained chunks still build from real
samples. Any future system that caches world coordinates must reset here too.

### 4.2 The frame loop (`main.ts`)

One loop serves both modes. In `menu` mode everything below still runs *except*
the economy tick, achievement checks, `updateSlowDrive`, the idle-banking
branch, autosave, and every stat write; the active camera rig is `MenuCamera`
rather than `ChaseCamera`. Those gates are the safety property the whole attract
mode rests on — a new `state` write added to this loop must be gated with them
(§4.1).

The active camera rig updates **before** `weather.update`, which reads the
camera position: the rebase block writes `camera.position` from the chase rig's
pose, and in menu mode that pose is stale, so a weather read taken before the
menu camera has run re-anchored particles kilometres away for one frame.

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
km) and a tail behind it that depends on who is holding the camera:
`PLAY_BEHIND = 3` while driving, `MENU_BEHIND = 22` in attract mode. So roughly
25–28 chunks are alive in play and 44–46 under the menu. Each chunk owns a road
strip, a terrain ribbon, and one merged scenery mesh. Chunks are allocated on
entry and disposed on exit — `update` builds any chunk in
`[cur - behind, cur + AHEAD]` that is not in the map, then removes and
`dispose()`s the geometries of every chunk outside it.

The two tails exist because the chase camera never looks back and the menu
director does (§6.4). At the driving tail the ribbon ends 180 m behind the car,
which a shot standing ahead of the car frames from ~200 m — near enough that
`FogExp2` leaves the cut reading as a stepped cliff with haze under the props
on its lip. `main.ts` calls `chunks.setBehind` on each mode change, and
`reseedMargin()` reads `chunks.behind` so a re-seed keeps road samples alive
for whichever tail is current. `MENU_BEHIND` and `menuCamera`'s
`MENU_SAFE_DISTANCE` are checked against each other in `menuCamera.test.ts`. There is no chunk pool;
the geometry buffers are rebuilt per chunk. A perf regression here looks like a
build spike at a chunk boundary, or geometries surviving the cull (see #5, #1).

**How far back the menu tail has to reach** is worth stating carefully, because
the obvious framing is wrong and was shipped wrong once. It is *not* a distance
from the eye. `RoadPath` winds hard enough to double back on itself, so a cut
600 m back along the arc is routinely only 250–350 m away in a straight line,
and lengthening the tail can bring the cut *nearer* rather than further as the
road loops around — measured across seven start positions, the nearest framed
cut sat at 244–558 m for every tail from 6 to 27 chunks, with no trend. Sizing
this against a euclidean distance looks reasonable and measures nothing.

What hides the cut is the land in between. Sampling the live attract mode — the
cut row raycast against the chunk meshes every frame, so a sample counts only
when it is genuinely unoccluded rather than merely inside the frustum:

| `MENU_BEHIND` | tail | frames | framed samples | **visible** | nearest visible |
|---|---|---|---|---|---|
| 3 (`PLAY_BEHIND`) | 180 m | 1530 | 423 | 24 | 193 m |
| 10 (was) | 600 m | 1500 | 191 | **191** | 267 m |
| 14 | 840 m | 1500 | 1833 | **824** | 348 m |
| 16 | 960 m | 1500 | 10111 | 31 | 1029 m |
| 18 | 1080 m | 831 | 5625 | 0 | — |
| 22 (now) | 1320 m | 1009 | 429 | 0 | — |

**Those rows are not equal weight and must not be read head to head.** Each is
one live run of whatever length the session lasted, and how much of the cut gets
framed swings by an order of magnitude with where on the road the car happens to
be. The row that decides the constant rests on 429 framed samples; the `16` row
rests on 10111 — 24× thinner evidence for the more important row. A zero on a
thin row means "this run never walked a stretch that exposes the cut" at least as
often as it means "closed". Only the shape survives that reading: exposure is
total at the driving tail and at 600 m, and intermittent-to-absent past ~1 km.

`menuCamera.test.ts` sweeps the same question offline, marching the sight line
against the height field over three start positions and eight shots. It is a
different and far looser instrument — it samples the height field rather than the
drawn mesh, knows nothing of scenery or the far-land backdrop, and counts a march
point that projects outside the ribbon as clear — so it is an **upper bound** on
exposure rather than a second opinion on the numbers above:

| `MENU_BEHIND` | tail | framed | seen | rate | nearest visible |
|---|---|---|---|---|---|
| 3 (`PLAY_BEHIND`) | 180 m | 41312 | 35959 | 8.7e-1 | 169 m |
| 10 (was) | 600 m | 10458 | 9090 | 8.7e-1 | 460 m |
| 14 | 840 m | 15961 | 5885 | 3.7e-1 | 705 m |
| 16 | 960 m | 23430 | 4803 | 2.0e-1 | 737 m |
| 18 | 1080 m | 32829 | 8565 | 2.6e-1 | 765 m |
| 22 (now) | 1320 m | 51943 | 6378 | 1.2e-1 | 688 m |
| 26 | 1560 m | 52709 | 0 | 0 | — |

An earlier revision of this section printed rates of 1.9e-5 in that table. They
came from a sweep whose visibility counter incremented only on a new
record-minimum distance — so it counted record improvements, not unoccluded
samples, and its rate was governed by its denominator. The figures above are the
same sweep with the instrument fixed.

The honest statement is narrower than "the cut closes past a kilometre". What the
tail reliably buys is **distance**: the nearest exposed point of the cut goes
169 → 460 → ~700 m over tails of 3, 10 and 14 chunks, and then stops. From 14 up
the sweep cannot order the tails at all — 22 sits *nearer* than 14, 16 and 18,
and the rate separates them no better. `menuCamera.test.ts` therefore asserts
exactly that much and no more: a 650 m floor on the nearest exposed cut, with
`PLAY_BEHIND` as a control that fails it at 169 m. **Do not tune either table
down to a threshold.**

22 rather than 14 is therefore a design argument, not a measurement. 1320 m is
`AHEAD * CHUNK_LEN`, so the ribbon's rear cut ends exactly as far out as its
forward cut: one number covers both ends of the world, met at both ends by the
same haze and the same `FAR_LAND_HAZE_SCALE` backdrop — plus eight chunks of
margin over the shortest tail the sweep cannot tell it from. Note what the haze
does *not* do here. Whatever the sweep still reports exposed sits around 690 m,
where the thinnest biome (`FOG_BASE_DENSITY` × `mist` 0.9) leaves 47% of the
cut's contrast. Haze reaches 6.3% only at 1320 m — the distance the tail *ends*
at, not a distance anything is seen at — so past ~800 m the occluding terrain is
the mechanism, and haze is the backstop for the forward cut alone. The cost —
twelve chunks over the previous menu tail, nineteen over the driving budget — is
paid only while the menu is up.

The road cross-section is a fixed column set (`ROAD_COLS`) running from dirt
shoulder through asphalt to the cream center line, and the terrain ribbon spans
`TER_COLS` from −165 m to +165 m with rows every `TER_ROW_STEP = 6` m. Terrain
height comes from `terrainHeight(path, s, lat)`, which blends the road's own
elevation into the surrounding land so the highway sits in the terrain rather
than on it.

`terrainHeight` is the analytic height *field*; it is not the surface the
player sees. The terrain mesh samples that field only at grid vertices — rows
every 6 m, columns as far apart as 50 m out in the fields — and draws flat
triangles between them, so on a slope or a hill crest the drawn surface
departs from the field by a lot: measured across 38.5k points, a median of
0.39 m and a p95 of 2.14 m. Anything that must *touch* the ground therefore has
to sample the drawn surface, not the field. `sampleTerrainMesh(path, s, lat,
out)` does that — it locates the cell, picks the triangle matching the
`gridIndices` winding, and solves the barycentric in world XZ against the real
corner positions, returning height and face normal. Solving in parametric
(s, lat) space instead is *not* equivalent: the (s, lat) → XZ map is bilinear
rather than affine across a cell, which is exact near the road but drifts to
~28 cm past 120 m. Grounding scenery to the field instead of the mesh was the
"floating trees" bug.

The far field used to fold, and the shape of that defect is worth keeping
because the fix is a constraint every future change to the ribbon inherits.

`RoadPath.curvature` is a closed-form sum of four sines, so the radius at any
`s` is exactly `1 / |κ(s)|` and the tightest bend the generator can produce is
the analytic bound `1 / (0.0042 + 0.0035 + 0.0028 + 0.0009)` = **87.7 m** — far
inside the ±165 m `TER_COLS` reaches. The parallel-offset map `P(s) + N(s)·lat`
stretches by `1 + κ·lat` per metre of `s`, so on the inside of a bend it
collapses to a point at `lat = -R` and turns inside out past it: a cell folded
exactly when `|lat| >= R`, and up to **19 terrain triangles** covered a single
XZ point.

A caution learned the hard way: s ≈ 24.6 km is a nearly *straight* stretch
(R = 1928 m, zero folded cells) and has twice been mistaken for a tight bend in
this project's measurements. Check `1 / |κ(s)|` before calling any location
tight, and derive these numbers rather than sampling them — the closed form
makes exact answers cheap. The genuinely tight bends on the shipping seed
(20260824) are **s = 21123 (R 92.4)**, **s = 99129 (R 91.3)** and
**s = 431619 (R 88.7)**.

The fix is `foldSafeLateral` in `roadPath.ts`, applied by `RoadPath.point` and
exposed as `RoadPath.effectiveLateral`. Below `FOLD_START = 0.6` of the local
radius it is the identity — which covers the road, the car, every pickup and
the near field at every curvature the generator can produce, so nothing near
the road moved — and past it the columns compress smoothly onto an asymptote at
`FOLD_LIMIT = 0.85` of the radius, C1 at the handover and monotone in `lat`.
The stretch factor therefore never drops below `1 - FOLD_LIMIT`, so no cell can
invert at any curvature.

Rates depend on which measure you use, so name it. Counting **terrain cells** —
a cell folds when either of its triangles winds backwards in XZ, which is what
actually crumples — over the first 102 km of the shipping seed, before and
after:

| band | before | after |
|---|---|---|
| \|lat\| 0-90 | 0% | 0% |
| \|lat\| 90-120 | 1.99% | **0%** |
| \|lat\| 120-165 | 8.58% | **0%** |

The global average badly understated the places it mattered: at each of the
three tight bends above, **50% of all cells** past |lat| 90 folded — which is
*every* cell on the inside of the bend, the outer half never folding. Samples
landing inside neither triangle of their own cell went from 17 in 335,070
(nearest at |lat| 95) to **zero**. Prop bases, measured against the terrain
geometry the ChunkManager actually hands three.js at those three bends, went
from up to **16.7 m** off the topmost drawn surface to **0.000 m** — every prop
now sits on the triangle the renderer draws.

Note what the compression means, because it is a real trade and not a free win.
The ground on the inside of a bend is not 165 m of ground; it is a disc of
radius R, and any map that claims otherwise covers the same dirt twice. So at
the tightest bends the ribbon's inner edge now reaches ~75 m rather than 165 m,
and the outermost column band collapses to a sliver there. That is the ribbon
telling the truth about how much inside-of-bend ground exists. It also means
the ribbon *narrows* on the inside of tight bends, and `world/farLand.ts` is
what stands behind it — the measured ribbon-edge silhouette at the three bends
dropped (19.2°/13.6°/4.3° to 10.2°/6.8°/3.4°), so the fan covers more of the
gap than it did, not less.

Heights and terrain colour both key off `effectiveLateral`, not the raw column
value: a column that landed at 80 m has to carry the land of 80 m out, not the
165 m far-field rise, or the ribbon grows a wall at its own edge.

The ribbon still cannot simply be widened to cover more ground — `TER_COLS` at
±420 folds catastrophically even now, because the compression would flatten
almost all of it into a sliver. Anything that must fill beyond the ribbon
belongs in world space, not path space.

The ribbon also simply *ends* at ±165 m, and a near-horizontal sight line runs
out over the fields, leaves it a metre or two above the surface and finds
nothing beyond — sky under the canopies on the horizon. `world/farLand.ts`
fills that: a radial fan anchored to the camera in **world space**, never in
path space, so nothing about it follows the road curve and nothing can fold.
It writes no depth and draws before every world mesh, so terrain and scenery
always paint over it and there is no seam to z-fight. It is ordered at -9.5:
after the sky dome, which it covers, but ahead of the sun and moon discs,
which it must not — `GodRaysEffect` makes the sun's material transparent, so
at medium and high the disc draws over the fan anyway, but on `quality: low`
the effect is never built and a fan ordered after the disc erases it through
the whole golden hour. That asymmetry between quality tiers is exactly the
kind of bug a mid-quality playtest cannot see.

It carries its own aerial perspective, and has to. The fan is a compressed
stand-in — 4 km of geometry standing for tens of km of implied land — so its
geometric radius is nowhere near the distance it depicts. Under the old fog that
never showed, because everything past 400 m was saturated either way; at 0.0014
it shows badly, because the ribbon's far edge 1320 m out is 96% hazed while the
fan pixel directly above it is only 340 m away and 19% hazed. Left alone the
backdrop stops being haze and becomes a vivid cone with a hard silhouette
sitting on a pale strip of terrain — measured, and plainly visible on screen.
`FAR_LAND_HAZE_SCALE = 4.5` fixes it by scaling the fan's **fog depth** in the
vertex shader (a per-vertex `aHaze` attribute injected at `<fog_vertex>`), so it
fogs on the distance it represents rather than the distance it occupies. The
value is derived, not tuned: the nearest ring a horizon-grazing ray can meet is
at radius 294.9 m, and `1320 / 294.9 = 4.477`. Rounding *up* matters, because
the two directions are not symmetric — a backdrop hazier than the terrain in
front of it is simply more recession, while one crisper than that terrain is the
failure above. Scaling depth rather than baking a colour also keeps `mist`, the
weather `fogMultiplier` and `nightness` working on the backdrop exactly as they
work on the ribbon, and the density cancels out of `r * S >= AHEAD * CHUNK_LEN`,
so the guarantee holds in every biome and weather rather than at one tuned
density. Above about 5 there is nothing left to buy: 4.5 and 7 are
indistinguishable on screen because the band is already saturated.

Its elevation rises monotonically with radius, from 10° below the eye at
120 m — well below ground level, so real terrain buries the inner rim wherever
the ribbon still reaches that far; on the inside of the tightest bends the
compressed ribbon stops nearer than 120 m and the fan simply shows through
under the horizon, which is what it is for — to a ridge that is a **floor of
7.6° with the wander folded upward**, occupying [7.6°, 9.0°] and never dipping
below the floor at any azimuth. That one-sidedness is the guarantee and must not be "simplified"
into a symmetric ±wander: the fan closes every gap below its silhouette and
none above, so a symmetric wander dips below the floor on part of the circle
and closure becomes a coincidence of azimuth. The floor is set by curvature —
the tighter the bend, the nearer the ribbon edge on its outside and the higher
its silhouette. On a straight the land silhouette tops out near 5.5°; at the
road's tightest bends (R 92.4 at s ~21.1 km, R 91.3 at s ~99.1 km, R 88.7 at
s ~431.6 km) it reaches 6.64°. Enclosed-sky pixels on a 1280x800 mask go from
200 to 0 at the sunflower-coast repro and from 3500-6500 to 0, terrain-only,
at those bends. The residual those measurements left — sky beneath scenery
standing on a folded flap — went with the fold itself; the ribbon-edge
silhouette at all three bends is lower now than when these figures were taken,
so the fan has more margin, not less. Worth re-measuring on a playtest all the
same.

Dash bleed at chunk seams and terrain winding after an axis flip have both been
bugs here (commits `2a3856d`, `ebbdbe9`). New geometry work in this file should
be checked at a seam, not mid-chunk.

### 5.4 Biomes (`biomes.ts`)

Eight biomes cycle in a fixed rotation with `BIOME_LEN = 2700` m per segment and
`BLEND_LEN = 520` m crossfade zones. `biomeAt(s, out?)` returns a `BiomeSample`
(`{ id, next, blend, weights }`), and every visual system samples that same
function. It is called several times a frame, so it writes into `out` rather
than allocating; `out` defaults to a module-level scratch, which makes
`biomeAt(s).id` safe and holding the returned object across another call
unsafe. A caller that keeps a sample owns one from `createBiomeSample()` —
`main.ts` does, because `blendColor`/`blendNumber` sample again later in the
same frame (§14's zero steady-state allocation budget is what forces the shape):

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

**Shadows use a different sun** (`world/sunShadow.ts`). `SunSnapshot` drives the
sky and the god rays, where a ~10 degree dawn/sunset elevation is the whole
point; shadow length is `cot(elevation)`, so that same sun throws shadows 5.7x
the caster's height. `SunShadow` therefore takes the snapshot's azimuth but
clamps elevation up to a floor (~23 degrees), keeping shadows at or under ~2.4x
the caster. It also owns the scene's single `DirectionalLight`: the ortho box
(±60 m, 2048 map) is biased ahead of the car along its heading and snapped to
the shadow map's texel grid so edges do not crawl as the car moves, the depth
range is derived from the box rather than guessed, and `castShadow` is gated off
below the horizon so nothing casts upward through the terrain at night. Because
one light has one direction, the clamp also raises the diffuse direction at
golden hour — accepted, since a second shadow-casting light is outside the perf
budget.

### 5.6 Weather (`weather.ts`)

A state machine over `clear | rain | fog | leaves | aurora` with `FADE_SEC = 8`
transitions. Aurora is night-only and rare. Leaves and petals draw their colors
from the current biome (`LEAF_DEFAULT` is the fallback). Weather feeds three
consumers: the particle systems, the audio mood, and the achievement tracker's
per-weather mile counters (`rainMiles`, `fogMiles`, `leafMiles`, `auroraMiles`).

Weather also multiplies earnings — aurora at ×1.50 is the largest situational
modifier in the game, which is deliberate: the rarest, prettiest weather is also
the most profitable, so noticing it is rewarded.

### 5.7 Scenery (`scenery.ts`, `grass.ts`)

Every scenery kind is a `Proto` — shared vertex/normal/color arrays built once.
Chunks do not instance these: `ChunkManager.buildScenery` CPU-bakes every
placement into a single merged `BufferGeometry` per chunk, transforming the
proto's vertices by the placement matrix and writing per-vertex colors. The
whole chunk's scenery is therefore one `THREE.Mesh` sharing the chunk material,
which keeps the draw call count flat at the cost of a per-chunk bake. Placement
is seeded from `s` so a given stretch of road always regenerates identically.
Painterly variation comes from `pickTint` on the baked vertex colors rather than
from distinct materials.

Props are grounded and oriented by `groundProp`, which samples the drawn
terrain surface (§5.3) rather than the height field. Two tuning tables live
with it. `SLOPE_FOLLOW` is how far each kind leans toward the face it stands
on — 1.0 for things that lie on the ground (grass tufts, rocks), tapering to
0.1–0.2 for trees and the windmill, which grew or were built vertical and only
pick up a hint of the lean. `MAX_TILT = 0.5` rad (~29°) caps the lean; real
land tops out near 26°, so the cap is the floor under the steepest cell the
height field can make rather than something the far field routinely hits. The
sink
is interpolated by the same follow value, `SINK_FLUSH = 0.03` m to
`SINK_UPRIGHT = 0.14` m: a prop lying flush with the face needs a sliver to
kill the seam, while one kept deliberately vertical on a slope must bury its
base deep enough that the downhill edge does not lift off. One number for both
floats tree trunks or swallows grass.

Props are not scattered independently. `buildScenery` emits them in seeded
*runs*: a clump anchor draws a kind, a side and a lateral band, then one to
eight members scatter within that kind's `CLUMP` reach of it. At the same count
this reads several times denser than an even sprinkle, because the gaps between
groves are what make the density legible as landscape rather than as texture.
An anchor is inset along `s` by its own reach, so no run crosses a chunk seam
and the obstacle keys stay owned by the chunk that made them. The near-road
canopy clamp (`|lat| < 17` → scale ≤ 0.9) and near-miss registration are
re-tested per member, not inherited from the anchor.

The bake runs in two passes. Pass one places, drawing every random number and
summing the proto vertex counts; pass two writes into `Float32Array`s sized
from that total. Growing three `number[]`s by a hundred thousand `push`es was
the bulk of the method's cost, and removing it is what paid for the density
increase: per-chunk build time went *down* from 1.81 ms to 0.82 ms while the
prop count went up ~1.85x.

`flowers` and `sunflowerPatch` — the most-stamped protos in the world now —
build their heads from `petalBlob` (an undivided icosahedron) with open-ended
stems, roughly a quarter of the vertices of the `blob` used for tree canopies.
At 9–24 cm across and never nearer than the shoulder, the subdivision was never
resolved.

Adding a scenery kind means: a new `SceneryKind` member, a `getProto` case, a
weight in the relevant `BiomeVisual` entries, a `SLOPE_FOLLOW` lean value (the
table is exhaustive over `SceneryKind`, so this one is a compile error rather
than a silent default), a `CLUMP` rule, and — if it should count for
near-misses — registration as an `Obstacle` in `chunks.ts`.

#### Dense ground cover (`grass.ts`)

Grass is the one thing in the world that does **not** ride the merged bake, and
the exception is worth stating precisely because it is easy to over-generalise.
The merged bake wins when a chunk holds a few dozen props of a dozen *different*
kinds: one mesh, one material, one draw call, and the per-vertex CPU transform
is paid over a few tens of thousands of vertices. Grass is the opposite shape —
thousands of copies of a *single* proto in one chunk — which is exactly what
`InstancedMesh` is for. Baking 2400 clusters through the merged path would cost
a CPU transform of ~72k vertices per chunk; instancing costs one matrix each
and still draws in one call. So the rule stands as it was: **one draw call per
chunk**, and the mechanism differs only where the kind count collapses to one.

Five things constrain the field:

- **A near band, not the `AHEAD` window.** Grass is invisible past ~150 m, so
  it is built only for `GRASS_BEHIND = 1` chunk behind the car and the tier's
  `ahead` (2–3) in front — four to five live meshes against the manager's 26
  chunks. Meshes are added and dropped as the car advances, so the steady-state
  cost is **one chunk built per chunk boundary**, never a window rebuild. A
  build spike at a boundary is the regression to watch (§5.3, §14).
- **Placement is on the drawn surface by construction.** Rather than scatter in
  `(s, lat)` and sample the surface back — `groundProp`'s route, at three
  `RoadPath.pose` lookups a prop — clusters are scattered *inside the terrain
  mesh's own cells*: pick a row, pick a column band, pick barycentric `(u, v)`,
  and interpolate the four corners on the same `a,b,c / b,d,c` diagonal the
  index buffer draws. The result lies on the rendered triangle exactly, with no
  per-cluster path sampling at all. Both this and `buildTerrain` read their
  corners from one exported `terrainRow`, so the two cannot drift; grounding to
  `terrainHeight` instead is the "floating trees" bug (§5.3).
- **Lateral bias toward the road.** `lateralDensity` is `1 / (1 + (lat/12)²)`,
  zeroed inside `GRASS_MIN_LAT = 5.9` m and past `GRASS_MAX_LAT = 75` m, and
  `GRASS_BANDS` integrates it across each `TER_COLS` pair into a cumulative
  distribution. The shoulder therefore carries ~19x the per-m² density of the
  far field. Uniform scatter over the ribbon would spend almost every blade on
  ground the chase camera never frames.
- **Floating-origin safety comes from the parent.** Each mesh hangs on its
  chunk's existing `THREE.Group`, so `ChunkManager`'s rebase, cull and
  `dispose()` lifecycle cover it for free. Nothing caches a world position, and
  the wind's spatial phase is keyed off `(s, lat)` rather than world XZ, so a
  rebase cannot shift the gust pattern (§5.2).
- **No shadow casting.** Thousands of instanced casters do not fit the shadow
  budget; `castShadow` is always false. `receiveShadow` is on at medium and
  high — without it, grass standing in a tree's shadow glows against the
  shadowed terrain underneath — and off at low.

Wind lives in the vertex shader; a CPU per-instance update at this count is not
affordable. A `MeshToonMaterial` is extended through `onBeforeCompile`, keeping
the toon ramp and the fog chunks (grass must sit inside the haze band like
everything else). Displacement is `bend × power × (0.55 + 0.45·sway + gust)`,
where `bend` is a per-vertex mask of blade-local height so the root stays
planted and the tip travels, `sway` is a slow sine offset per instance by
`swayPhase(s, lat)` so a field never pulses in lockstep, and `gust` is a faster
sine whose phase is advanced by `ripplePhase(s, lat)` — a projection of path
position onto the gust axis — so gusts read as travelling across the field.
The instance matrix carries a random yaw, so the world wind vector is projected
onto the instance's own axes before it displaces anything, and the inverse
scale cancels the scale the matrix re-applies. A bending blade also shortens,
or the tips stretch as they lean. `uTime` wraps at `GRASS_TIME_WRAP`, a period
over which both sine rates complete a whole number of cycles, which keeps the
float32 uniform precise across a session measured in days without a visible
jump. Strength comes from `windStrength(rainIntensity, leafIntensity)` fed from
`Weather.intensity` — calm in `clear`, roughly 3.5x that in rain.

Colour follows the biome through `blendColor` over `ground`/`groundAlt`,
sampled at both ends of the chunk and lerped per cluster, so the field is
continuous across a seam and does not pop at a biome crossfade (§5.4).
Per-instance variation rides `InstancedMesh.setColorAt`, and the blade's own
vertical gradient rides the proto's vertex colours; three.js multiplies both.

Blade quads are emitted with **both windings** against a `FrontSide` material
rather than using `DoubleSide`: three flips the normal on a back face, which
would leave half of every blade unlit, and the up-biased normal is what makes
grass shade like the ground it stands on. The cost is index-buffer size, not
vertex or fragment work, since one of the two is always culled.

`GRASS_TIERS` is the quality ladder. `low` is not merely thinner: it drops a
blade and a height segment from the proto, compiles the gust term out of the
shader, loses the shadow-map fetch, and carries one chunk fewer — genuinely
cheaper, the way §5.8 requires of `low`. Quality changes route through
`GrassField.setQuality` from the same `UIActions.setQuality` path
`PostFX.setQuality` takes; the field bumps a revision, `ChunkManager` records it
per chunk in the typed `Chunk.grassRev` as it builds that chunk's grass, and any
chunk holding an older one is rebuilt. That comparison runs per band chunk per
frame, so it is kept off `userData` deliberately: an untyped stamp that stopped
matching would rebuild the whole band every frame with nothing to catch it.

### 5.8 Materials and post-processing (`materials.ts`, `postfx.ts`)

`toonRamp()` builds the 3-step `DataTexture` every toon material samples;
`toonMat(color)` and `vertexToonMat()` are the two constructors used across the
world. The painterly look is the sum of: 3-step toon shading, saturated pastel
palettes, per-instance vertex-color jitter, `FogExp2` tinted from the biome
blend, the gradient sky, and the effect stack.

#### Fog and aerial perspective

`scene.fog` is a single `FogExp2` driven from `main.ts` every frame. Density is
`FOG_BASE_DENSITY * mist * (1 + nightness * 0.25)`, where `mist` is the biome's
own multiplier put through `Weather.fogMultiplier`. `FogExp2` extinguishes
contrast as `exp(-(d * density)^2)`, so the base density is really a statement
about how far the world keeps its colour:

| distance | 0.0038 (was) | **0.0014 (now)** |
|---|---|---|
| 200 m | 44% | **7.5%** |
| 300 m | 73% | **16.2%** |
| 400 m | 90% | **26.9%** |
| 500 m | 97% | **38.7%** |
| 600 m | 99.4% | **50.6%** |
| 800 m | 100% | **71.5%** |
| 1000 m | 100% | **85.9%** |
| 1320 m | 100% | **96.7%** |

The old column is the "distant terrain goes white in clear weather" report: past
roughly 400 m every frame was one flat tone, worst in Emberwood where a bright
band sat against saturated orange canopies. The floor under the new value is the
ribbon, not taste — it ends at `AHEAD * CHUNK_LEN` = 1320 m, and the haze is
what hides that cut, so a thinner fog forces `AHEAD` up and costs build time and
memory (§14).

Colour is the other half, and it was the larger half of the *white*. The fog was
the sky's horizon colour lerped **0.42** toward the biome `fogTint`; against an
already pale daytime horizon that landed on a milky non-colour belonging to
neither the sky nor the land. It is now built as aerial perspective: start from
`sky.horizonColor`, take only `FOG_BIOME_TINT` (0.16) of the biome tint so the
tint is an identity rather than the whole answer, pull `FOG_AERIAL_MIX` toward
`AERIAL_HAZE` (a desaturated sky blue — scattered light is the same blue the sky
is), and finally darken by `FOG_SHADE`. That last step is what keeps the far
ridge legible: distant land reads as land because it sits a little deeper in
value than the air above it, and a fog colour identical to the horizon dissolves
the silhouette into the sky. The aerial mix backs off through golden hour, where
the scattered light genuinely is warm, and to zero at night.

The backdrop has to be told about all this separately — see
`FAR_LAND_HAZE_SCALE` in §5.3, and the module comment in `world/farLand.ts`.

`PostFX` composes god rays (pmndrs `GodRaysEffect` on the sun disc), bloom,
vignette, and SMAA. The quality setting (`low | medium | high`) scales this
stack; `low` is the escape hatch for weak GPUs and must remain genuinely
cheaper, not merely dimmer.

### 5.9 Handcrafted models (`world/models/`, `tools/blender/`)

Individual assets may be replaced by a Blender-authored model. **Procedural
remains the default**: `getProto` and `buildCar` look for a handcrafted model
and fall through to `buildProceduralProto` / `buildProceduralCar` when there
isn't one, which is the ordinary case. The opt-in is the existence of a recipe
in `assets/models/src/`.

Nothing is fetched. A Blender recipe is exported to a readable `.evr.json`
intermediate, and `npm run models` quantises that into `models/generated.ts` —
Int16 positions against a per-part bounding box, Uint16 indices, Uint8 shade,
with normals derived at boot from triangle winding. A full car costs roughly
5 kB of bundle. Scenery decodes into exactly the `Proto` shape `buildProto`
produces, so `chunks.ts` bakes a handcrafted tree through the same merged-
geometry path with no extra draw call; cars decode into exactly the `CarRig`
shape `animateCar` and `disposeCar` expect.

`?models=procedural` disables handcrafted models at runtime for comparison, and
`/model-viewer.html` (dev only) renders both side by side under the game's
materials. The full reference is docs/MODELS.md.

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
and a palette — no models are loaded, unless a handcrafted recipe exists for
the body type (docs/MODELS.md); `compact`, the starter, is the one that does.
Body types span compact, sedan, wagon, pickup, van, classic, muscle, sports,
super, and hover. `animateCar` rolls the wheels and adds body roll; `hoverBob`
is the Auroracraft's idle float. Shared constants: `GLASS`, `TIRE`, `HUB`.

Two wheel traps, both fixed in `fix/wheel-spin` and both easy to reintroduce:

- Wheel meshes must carry Euler order **`ZYX`** (`world/wheelFrame.ts`,
  `axleFrame`). Under the default `XYZ`, advancing `rotation.y` after the 90°
  Z tilt rotates about the parent's vertical axis and the wheel yaws flat in
  the arch instead of rolling. Same class of trap as the camera Euler clamp in
  §6.4.
- The per-frame spin is capped at `MAX_WHEEL_STEP` (12°). A 12-sided tyre
  repeats every 30°, so anything past 15°/frame is ambiguous and frame-time
  jitter flips the apparent direction. Above roughly 4 mph the wheel therefore
  turns slower than the ground; that is a sampling limit, not a bug.

Swapping cars rebuilds the rig. Anything holding a reference into the old rig
(camera target, exhaust emitters, audio position) has to be re-pointed on
`carSelected`.

### 6.4 Camera (`world/camera.ts`)

`ChaseCamera` is a damped follow rig behind and above the car, with true-yaw
orbiting (`rotation.y` set directly rather than through Euler clamping — the
Euler approach was a bug, commit `2a3856d`). There is deliberately no idle sway.
Camera damping is `dt`-driven, so it stays stable through frame-rate changes.
`snapTo(vehicle)` hard-sets the rig to its steady-state pose with no damping,
and is what makes leaving the menu read as a cut rather than a swoop.

**`MenuCamera` (`world/menuCamera.ts`)** is the attract-mode shot director. It
drives the *same* `PerspectiveCamera` instance `ChaseCamera` owns — `PostFX`
captures one camera reference at construction, so a second camera would never
be rendered. Eight shots (low chase, drone fly-by, camera-car tracking, crane
reveal, overtake, roadside static, hero low-front, orbit) each declare their own
duration (7–11 s) and focal length; cuts are hard, never repeat back-to-back,
and draw uniformly over the rest.

Shots are composed in the **road frame** — an `s` offset along the curve, a
lateral offset, and a height above the road surface — never as world positions.
That makes height follow the road's own elevation and makes latched vantages
rebase-invariant for free (§5.2). Every shot is then clamped to
`MIN_TERRAIN_CLEARANCE` above `terrainMeshHeight` (§5.3 — the terrain *as
drawn*, the same query scenery grounds to), probed at several points along the
sight line so the eye lifts over an intervening ridge instead of punching
through it. The lift applies immediately and only its release is damped, so the
camera never clips and never snaps down off a crest. It clamps rather than
repositions: low shots still skim.

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
  lowpass breathing on a 0.06 Hz LFO) and wind chimes with a feedback delay.
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

**Main menu (`ui/mainMenu.ts`).** The title screen shown while
`runtime.appMode === 'menu'`, over live attract footage (§4.1). Continue (with a
`SaveSummary` line, disabled with a stated reason when `hasSave()` is false),
New Journey (arm-and-confirm when it would erase a save), and Settings, which
opens the existing panel. Because the background is the moving world and not a
fixed colour, legibility is structural — a directional scrim over the text
column, glass under the buttons, text shadow on the free-standing lines — and
never an assumption that the sky is dark.

**Mode transitions (`ui/transition.ts`).** The UI owns *all* transition timing.
`UIActions.startGame` / `quitToMenu` are synchronous world resets; the fade
cover goes opaque, calls the action, then fades back, which is what hides the
car swap and the world reset. The cover takes `pointer-events` for the whole run
and exposes `busy` so keyboard paths cannot double-fire it.

Gameplay furniture — HUD, toasts, biome banner, prestige flash, the offline
modal — is hidden on `body[data-appmode='menu']`, and the offline modal is
dismissed outright on the way out so it cannot outlive its session.

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
- **`hasSave()`**: whether the stored save parses and is not a refused
  future-version save. Deliberately side-effect free — unlike `loadGame` it
  neither hydrates nor writes the `-future` backup key — because the main menu
  calls it to decide whether Continue is offered, and a menu poll must not
  shuffle storage.
- **Autosave**: every 5 seconds during play, and on tab close. Gated on
  `appMode === 'playing'` — a menu-mode write would stamp `lastSaveTime` and
  silently eat the player's offline progress (§4.1). Every write in `main.ts`
  goes through one `persist()` helper so a refused write reaches the player.
- **`saveGame` returns a `SaveWriteResult`**, and only `ok` means storage
  changed. `lastSaveTime` is stamped on the write that actually happens, never
  on a refused one, so a refusal leaves the caller's offline accounting intact.
- **Two tabs, one save**: each tab loads its own `GameState` at boot, so a tab
  holding an old snapshot could once autosave it straight over a tab that had
  been playing for an hour — unrecoverable, since there is no server copy.
  `saveGame` now defends: the module remembers the `lastSaveTime` it last saw
  in storage (stamped on every load and every successful write) and refuses to
  write when storage has moved past it, returning `conflict`. The refusal is
  sticky by construction — the losing tab's baseline can never catch up — and
  `main.ts` toasts once to say this tab has stopped saving and a reload is the
  way back to the real progress. The rule is last-writer-keeps: the tab that
  actually saved owns the save, and no merge is attempted.
- **Unknown fields, and the types of the known ones**: `hydrate` builds the
  state key by key and **strips** any unknown top-level field a hand-edited or
  imported save carries. There is no
  forward-compat scratch space at the top level: an unknown key is dropped on
  the way in rather than living in the state object and being written back out
  by the next autosave. (The strip is top-level; the nested `stats`,
  `currencies` and `settings` blocks are still merged over defaults, and
  `initEconomy` is what sanitises their values.) The fields hydrate resolves
  itself are type-checked rather than merely defaulted: `lastSaveTime` and
  `createdTime` must be finite numbers, `currentCarId` a string, and
  `ownedCars` a real array — a string has a truthy `.length` too, and used to
  reach the car catalog looking like a list of ids. Because the shape is
  explicit, adding a `GameState` field is a compile error until `hydrate` names
  it — which is the intended nudge toward a migration.
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
- **Downgrade recovery**: the `-future` key is read back, not write-only. On
  every boot `loadGame` checks it first and recovers what is parked there when
  two things hold: the parked save is readable now (`version <= SAVE_VERSION`),
  and its `version` is **strictly higher** than the version on the primary key.
  That second rule is what a downgrade actually looks like — the older build
  stamps its own lower version on everything it writes — and it is
  self-limiting, which is what keeps the swap below from ping-ponging the two
  keys on every boot. Save *times* are deliberately not the test: the fresh
  start the older build wrote is always the more recent write, so a time
  comparison would never fire.
- **Recovery swaps, it does not delete**: the recovered save is written to the
  primary key and the save it displaces is written into the `-future` key in
  its place — a player who downgraded and then played the older build for a
  month still has that month parked afterwards, out of the way rather than
  gone. The two writes are separate `try` blocks on purpose. If the promotion
  fails, nothing has moved and the next boot retries; if only the parking of
  the displaced save fails, the recovered save is already on the primary key
  and the version rule stops the stale backup from promoting itself over it
  again. Recovery is skipped entirely while the primary key itself holds a
  future-version save — the newest save in storage has first claim on the
  backup slot.
- **A build that cannot protect the newer save may not destroy it**: if parking
  the refused save under the `-future` key throws (a transient write failure —
  the permanent kind blocks the autosave too, which is why the save usually
  survived by accident), a module flag latches and every `saveGame` for the
  rest of the session is a no-op returning `locked`. The session plays; it just
  does not write.
- **`clearSave` parks before it erases**: `hasSave()` reads false for a
  future-version save, so the menu disables Continue *and* skips the New
  Journey confirmation — an unconfirmed click would otherwise land on
  `clearSave` with the newest save in the world under the primary key. So when
  the primary holds a future-version save, `clearSave` copies it to the
  `-future` key first; that also protects it, which releases a latched write
  lock. If it cannot be parked, nothing is cleared — storage that refuses
  writes is not a reason to destroy the only copy of a journey — and the
  session, still write-locked, says so through the warning below. An ordinary
  save is cleared with no ceremony, and a `-future` backup already in place is
  left alone (`clearSave` is "erase my progress", not "throw away the save this
  build could not read").
- **Telling the player**: `main.ts` keeps "a refusal is waiting" and "a refusal
  has been shown" as two separate flags. The toast may not be raised at the
  moment of the refusal — `gameToast` drops anything raised outside `playing`,
  and the write on `visibilitychange` happens as the tab disappears, where a
  4.5 s toast expires unseen — so the refusal is queued and the frame loop
  flushes it once, when `appMode === 'playing'` and the tab is visible. All
  three non-`ok` results warn, `error` included: full or blocked storage means
  the player is not being saved either.
- **Import adopts only what it managed to write**: the `importSave` action
  sanitises the decoded save, writes it, and replaces the live state only if
  that write returned `ok`. A refused write must not leave the game running a
  journey that was never persisted, so the panel gets `false` and shows its
  inline error instead.
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

**App shell** — `AppMode` (`'menu' | 'playing'`) on `runtime.appMode`, and
`SaveSummary` (journey/lifetime miles, coins, resolved `carName`,
`prestigeCount`, `lastSaveTime`) for the menu's Continue line.

**Save** — `SaveWriteResult` (`'ok' | 'conflict' | 'locked' | 'error'`)
returned by `saveGame`; anything but `ok` means storage was left untouched, and
`main.ts` turns the two deliberate refusals into a single player-facing warning
(§12).

**Event bus** — `GameEvents` declares fifteen typed events: `achievement`,
`pickup`, `purchase`, `carSelected`, `prestige`, `biomeChange`,
`weatherChange`, `phaseChange`, `offlineSummary`, `driftEnd`, `nearMiss`,
`toast`, `saveExported`, `uiPanelChange`, `appModeChange`. `EventBus.on` returns its own
unsubscribe function; anything that subscribes and can be torn down must call
it.

**UI** — `UIDeps { state, runtime, catalogs, actions, bus }` and `UIActions`
(buy/select car, buy upgrade, buy global, cost getters, prestige preview and
commit, export/import/reset save, audio and quality setters, `getCarSpeed`,
plus the app-shell four: `hasSave`, `getSaveSummary`, `startGame('continue' |
'new')` and `quitToMenu`). The last two are synchronous world resets — the UI
owns the fade around them. Note that `UIActions` has no volume setters: the settings panel mutates
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
| Live chunks | 25–28 driving, 44–46 in menu | `AHEAD = 22`, `PLAY_BEHIND = 3`, `MENU_BEHIND = 22`, `CHUNK_LEN = 60`. The menu tail is sized by what occludes the rear cut, not by a fog distance — §5.3 |
| Live coin instances | ≤ 160 | `COIN_CAP` |
| Draw calls | One per chunk for merged scenery, one more for its grass | A per-object draw call in `scenery.ts` is a regression. Measured 98 -> 102 for the whole scene when the grass band is added |
| Per-chunk build | ~2 ms at `quality: high` | 1.81 ms before the density overhaul; 0.82 ms for the merged bake alone after it, 1.97 ms with `high` grass. One chunk is built per chunk boundary, never a window |
| Grass band | 4-5 live `InstancedMesh`es, 1800-12000 clusters | `GRASS_TIERS` x `GRASS_BEHIND`. Never the `AHEAD` window |
| Cold start to playable | Under ~3 s on a warm cache | Nothing is fetched; the loading screen covers scene construction |
| Bundle | Well under the 1500 kB Vite warning ceiling | Three.js dominates; a new dependency needs a reason |
| Handcrafted models | ≤ 120 kB of decoded geometry across all of them | Enforced by `npm run models`; a scenery proto should sit near its procedural counterpart's triangle count, not the ceiling |
| Audio nodes | Bounded — one-shots are constructed, played, and released | A leak here shows up as gradual CPU climb over a long session |
| localStorage write | Every 5 s, single JSON serialize | Growth in `GameState` is growth in this write |
| Offline computation | O(1) regardless of gap | Capped at 14 days; never a replay loop |

---

## 15. Quick Reference

### Commands

| Command | Does |
|---------|------|
| `npm run dev` | Vite dev server (`vite.config.ts` pins port 5199, strict) |
| `npm run typecheck` | `tsc --noEmit` — the lint gate |
| `npm test` | Vitest in watch mode |
| `npm run test:run` | Vitest once |
| `npm run verify` | typecheck + tests + build — the full gate |
| `npm run build` | typecheck + `vite build` |
| `npm run preview` | Serve the built bundle |
| `npm run format:check` | Prettier check over `src/**/*.{ts,css}` |
| `npm run models` | Rebuild `src/world/models/generated.ts` from `assets/models/` |
| `npm run models:check` | Fail if the generated module is stale — the CI gate |
| `npm run models:blender` | Re-run the Blender recipes (needs Blender locally) |
| `npm run models:smoke` | Exporter regression test (needs Blender locally) |
| `npm run changelog` | Rebuild `src/version/changelog.generated.ts` from CHANGELOG.md |
| `npm run changelog:check` | Fail if it is stale or the versions disagree — the CI gate |
| `npm run electron` | Run the built `dist/` inside the Electron shell |
| `npm run electron:dir` | Build + package unpacked into `release/` — the fast check |
| `npm run electron:build` | Build + real installers into `release/`, publishing nothing |

### Fixed decisions

| Decision | Value |
|----------|-------|
| Package manager | npm (`package-lock.json` is committed) |
| Node in CI | 22 |
| Dev port | 5199, strict |
| Save key | `everroad-save-v1`; export prefix `EVR1.` |
| Three.js | r185, with `@types/three` pinned to match |
| Backend | none, ever |
| External assets | none, ever — nothing is fetched at runtime |
| Asset authoring | procedural by default; individual assets may be replaced by a Blender model compiled into the bundle at build time (docs/MODELS.md) |
| Repository | `Troll-Phace/everroad`, default branch `main` |
| CI | `.github/workflows/ci.yml`; `.githooks/pre-push` mirrors it locally |
| Versioning | Semantic, pre-1.0; every change is a patch bump, tagged `vX.Y.Z` |
| Patch notes | CHANGELOG.md is the source of truth; the in-game module is generated |
| Desktop shell | Electron, `contextIsolation` + `sandbox` on, `nodeIntegration` off |
| Code signing | None — builds are unsigned (docs/RELEASING.md) |

### Tuning constants at a glance

| Constant | Value | Home |
|----------|-------|------|
| `BASE_COINS_PER_MILE` | 60 | `game/economy/economy.ts` |
| `BIOME_LEN` / `BLEND_LEN` | 2700 m / 520 m | `world/biomes.ts` |
| `CHUNK_LEN` / `AHEAD` / `PLAY_BEHIND` / `MENU_BEHIND` | 60 m / 22 / 3 / 22 | `world/chunks.ts` |
| `GRASS_BEHIND` | 1 chunk | `world/chunks.ts` |
| `GRASS_TIERS` clusters/chunk | 450 / 1200 / 2400 (low / medium / high) | `world/grass.ts` |
| `GRASS_TIERS` blades x segments | 3x1 / 4x1 / 5x2 | `world/grass.ts` |
| `GRASS_TIERS` chunks ahead | 2 / 3 / 3 | `world/grass.ts` |
| `GRASS_MIN_LAT` / `GRASS_MAX_LAT` | 5.9 m / 75 m | `world/grass.ts` |
| `GRASS_SWAY_RATE` / `GRASS_RIPPLE_RATE` | 0.9 / 2.7 rad/s | `world/grass.ts` |
| `GRASS_TIME_WRAP` | 2pi*1000 s (~1.7 h) | `world/grass.ts` |
| Scenery `density` per chunk | 68-94 by biome | `world/biomes.ts` |
| `DS` / `ROAD_HALF_WIDTH` / `LANE_OFFSET` | 2 m / 4.6 m / 2.1 m | `world/roadPath.ts` |
| `FOG_BASE_DENSITY` | 0.0014 | `main.ts` |
| `FOG_BIOME_TINT` / `FOG_AERIAL_MIX` / `FOG_SHADE` | 0.16 / 0.40 / 0.10 | `main.ts` |
| `FOG_FULL` / `RAIN_HAZE` | 4.4 / 0.9 | `world/weather.ts` |
| `FAR_LAND_HAZE_SCALE` / `FAR_LAND_HAZE_RAMP_T` | 4.5 / 0.25 | `world/farLand.ts` |
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
- docs/MODELS.md — the Blender -> bundle model pipeline
- docs/RELEASING.md — the release procedure, and the unsigned-build caveat
- docs/BUILDLOG.md — running build diary

---

## 16. Desktop Packaging & Releases

### 16.1 Two runtimes, one bundle

EverRoad ships to two places and builds only once. `vite build` produces
`dist/`; the web version serves it, and the desktop version is that same
directory loaded over `file://` inside an Electron window. There is no desktop
fork of the game, no build flag that changes what the game does, and no
Electron import anywhere under `src/`.

**Development does not move.** `npm run dev` is the Vite dev server on port
5199, in a browser, exactly as before — that is where the game is built and
playtested, and the Electron path is a packaging concern that runs at release
time. `electron/main.cjs` can load the dev server when `ELECTRON_DEV=1` is set,
but that is a convenience for debugging the shell itself, not a workflow.
Anything that made the browser the second-class target would be a regression:
the browser is where the frame budget in §14 is measured.

The renderer therefore has to work with no desktop shell at all. The bridge is
strictly additive — every desktop affordance is written against `desktop()`
returning `null`, and the web build is the case that must not break.

### 16.2 Process model, and why the hardening is not optional

Electron gives a renderer as much or as little of Node as you configure. Three
settings in `electron/main.cjs` decide it, and all three are load-bearing:

```
contextIsolation: true     preload globals live in a separate V8 context
nodeIntegration: false     no require/process/Buffer in the page
sandbox: true              the renderer runs in the OS sandbox
```

The reason to treat these as a hard rule rather than a default worth revisiting
is the shape of this particular renderer. It runs Three.js, a shader compiler,
and a postprocessing stack — a large third-party surface parsing a lot of data.
Any of that going wrong in a browser tab costs the tab. The same thing going
wrong with `nodeIntegration: true` costs the user's filesystem. The safety
property is worth more than any convenience that turning them off would buy,
and nothing in the game wants Node anyway.

Everything else follows from the same reasoning. `setWindowOpenHandler` denies
every popup unconditionally and hands nothing to the real browser: the game has
no `window.open`, no anchor and no `target="_blank"`, so a `shell.openExternal`
there could only ever be reached by something that was not us — a way to launch
an attacker-chosen URL and nothing else. It comes back, allowlisted by host, on
the day the game grows a real outbound link. `will-navigate` and `will-redirect`
refuse anything that is not the app's own content, and "own content" means the
one `file:` URL of the built `dist/index.html`, compared exactly — matching on
the `file:` scheme alone would make `file:///etc/passwd` own content and give
the guard away. Webviews are refused outright.

Permissions are denied with exactly one exception:
`clipboard-sanitized-write`, which is what `navigator.clipboard.writeText`
asks for and what Settings' "Copy save code" button is built on. A blanket
denial is the tempting default and it is wrong here — it turned a feature that
works in every browser into a "Copy failed" toast in the shipped binary, with
nothing thrown and nothing logged. Camera, microphone, geolocation and
notifications stay denied, because the game genuinely asks for none of them.
`setPermissionCheckHandler` is set to the same predicate, so the synchronous
and asynchronous paths cannot disagree.

### 16.3 The Content-Security-Policy

Set as a response header on the default session, so it covers the document and
every asset:

```
default-src 'self';  script-src 'self';
style-src 'self' 'unsafe-inline';
font-src 'self';
img-src 'self' data: blob:;  connect-src 'self';
object-src 'none';  base-uri 'none';  frame-src 'none';
form-action 'none'
```

`form-action` is spelled out because it does not fall back to `default-src`;
the page has no forms and must not be able to post one anywhere. The directives
are built as a keyed map and joined at the end, so the dev-mode relaxation below
rewrites them by name — a positional edit is correct until someone reorders the
list, and then it silently loosens the wrong directive.

Each relaxation is something the shipped page genuinely needs, and the list is
short enough to audit at a glance. `style-src 'unsafe-inline'` covers the inline
styles the overlay writes, and `img-src data:` covers the emoji favicon. Note
what is *not* here: no remote host on any directive. Quicksand and JetBrains
Mono are self-hosted from `src/fonts/` (latin subset, variable, one woff2 per
family, ~58 kB committed), so `style-src` and `font-src` stay at `'self'` and a
packaged launch with no network renders in the intended faces rather than
reshaping into a system sans/mono. The `fonts.googleapis.com` /
`fonts.gstatic.com` entries that used to sit on those two directives existed
only to permit that remote load; adding a host back is a change to argue for,
not a convenience.

The important line is `script-src 'self'` with neither `'unsafe-inline'` nor
`'unsafe-eval'`: it is what makes an injected string unable to become code, and
it is the directive to defend when something asks for an exception. In dev mode
the policy is loosened for Vite's inline HMR client and its websocket — that
branch cannot run in a packaged build, because `DEV` is gated on
`!app.isPackaged` before `ELECTRON_DEV` is even consulted. Without that gate an
environment variable would be enough to repoint a released binary at whatever
answers on port 5199, under a CSP that allows inline script.

### 16.4 `window.everroad` — the whole main↔renderer surface

`electron/preload.cjs` exposes exactly one object through `contextBridge`:

```ts
interface EverRoadDesktop {
  readonly version: string;      // app.getVersion(), via additionalArguments
  readonly platform: string;     // process.platform
  quit(): void;                  // ipcRenderer.send('everroad:quit')
  readonly updates?: EverRoadUpdates;   // §16.8; absent in the web build
}
```

No `ipcRenderer`, no `require`, no `fs`, no generic "invoke any channel" escape
hatch. A generic bridge is the mistake that quietly undoes contextIsolation, so
this one grows one named method at a time, deliberately, each with a main-side
handler that validates its sender.

`version` arrives through `additionalArguments` rather than
`process.env.npm_package_version`, because that env var only exists when npm
launched the process and is absent in the packaged app — which is the case that
matters. `app.getVersion()` reads the packaged `package.json`, so passing its
result down through argv is the one route that is correct in both.

`everroad:quit` is validated, not trusted: the request is honoured only from the
top frame of the window the app created, showing content it recognises. A
subframe asking to quit the application is precisely the case to refuse.

`src/version/desktop.ts` shape-checks the global rather than merely testing for
its presence — `window.everroad` is a name anything could squat on, and a
half-formed object should fail at the boundary rather than at a call site.
`updates` is checked *separately*, by `desktopUpdates()`, and not folded into
that predicate: a malformed updater object should cost the player the update
affordance and nothing else, rather than also taking away Quit to Desktop, which
has no relation to it.

### 16.5 The version module

`src/version/` is a leaf (§3.4): it imports nothing from the game, and the game
imports it only to display what it says.

```ts
APP_VERSION   '0.1.17'      from package.json
BUILD_COMMIT  'a1b2c3d'     short sha, or 'dev' with no .git
BUILD_DATE    '2026-08-24'  the commit date
runtime()     'desktop' | 'web'   desktop iff the bridge is present
isDesktop()
buildLabel()  'v0.1.17 · desktop · a1b2c3d'
```

The three constants are compile-time substitutions, not runtime lookups: Vite's
`define` replaces them from `scripts/lib/build-info.mjs`, which reads
package.json and `git rev-parse`. Baking them in means they cannot drift from
the bundle they identify, and reading them costs nothing. Every git call is
guarded — a build from a source tarball with no `.git` falls back to `'dev'`
rather than failing — and `GITHUB_SHA` overrides, so CI stamps the real commit.

`vitest.config.ts` declares the same defines from the same helper, so the module
is unit-testable without stubbing globals. One consequence worth knowing: a
version bump does not reach a *running* dev server, because the define was
evaluated when the config loaded. Restart `npm run dev` after bumping.

`runtime()` is the only place the game distinguishes the two builds, and it does
it by feature detection rather than a build flag — which is what keeps one
bundle serving both.

### 16.6 CHANGELOG.md → the in-game patch notes

`CHANGELOG.md` is the source of truth for what shipped. `npm run changelog`
parses it into `src/version/changelog.generated.ts`, which the What's New panel
renders. The generated module is **committed**, exactly as the model codegen is
(§5.9), for the same reason: the browser fetches nothing at runtime, and CI does
not have to regenerate before it can build.

Bullet text keeps its Markdown `**bold**` intact — the panel renders that to
`<strong>` and strips nothing else — and wrapped lines are joined into one
string. The parser is deliberately strict, because a changelog that quietly
half-parses ships a patch-notes panel with missing bullets that nobody notices
for three releases. Anything it does not recognise is an error with a line
number, and nested list items are rejected outright since the panel has no way
to draw them.

The **three-way agreement** — the git tag, `package.json`'s `version`, and the
newest heading in `CHANGELOG.md` all naming the same release — is enforced in
two places, and it is worth being precise about which does what.
`npm run changelog:check` proves two of the three legs: that the changelog's
newest entry matches `package.json`, and that the generated module matches the
changelog. It never sees a git tag. The tag leg — tag == `v$(package.json
version)` — is checked by the `guard` job's *Resolve and verify the version*
step in `.github/workflows/release.yml`, before the draft release is created and
before any platform is packaged. `changelog:check` itself runs in three places:
`npm run verify`, the `changelog` job in CI, and again in `guard`. A build that
lies about its own version is a build whose bug reports cannot be trusted, which
is why both halves are repeated rather than assumed.

### 16.7 The release workflow

Pushing a `v*.*.*` tag runs `.github/workflows/release.yml` in three stages:

```
guard      (ubuntu)   changelog:check, npm run verify, tag == v$(package.json
                      version), extract the notes, create the Release as a DRAFT
package    (matrix)   macos / windows / ubuntu: npm run build,
                      electron-builder --publish always -> upload into the draft
finalize   (ubuntu)   write the notes, mark prerelease for 0.x, publish
```

`guard` runs the full `npm run verify` before it drafts anything, so a tag can
never ship a commit that has not passed the same gate every PR passes — pushing
a tag is not a way around CI. It also refuses to touch a release that is already
published: a draft may be refreshed by a re-run, but overwriting a published
release changes what a version means for everyone who already downloaded it.

The draft is created up front so three concurrent `electron-builder` runs cannot
race to create the same release, and it means a failure part-way leaves an
unpublished draft rather than a broken public release. The release body is the
version's own CHANGELOG section, extracted by `scripts/release-notes.mjs` rather
than hand-copied, so the notes are written exactly once. EverRoad is pre-1.0, so
every `0.x` release is marked a prerelease automatically.

Targets: `dmg` + `zip` for macOS on x64 and arm64 separately (a universal binary
would make every user download the slice they cannot run), `nsis` plus a
portable `.exe` for Windows, and an `AppImage` for Linux. The packaged app
contains `dist/`, the two files in `electron/`, and `package.json` — no
`node_modules`, because Vite has already bundled Three.js and postprocessing and
the main process requires nothing else.

**Builds are unsigned.** There is no Apple Developer certificate and no Windows
code-signing certificate, so macOS Gatekeeper and Windows SmartScreen both warn
on first launch. That is expected rather than a build fault, and
docs/RELEASING.md documents exactly what a user sees on each OS and how to get
past it.

### 16.8 Automatic updates

The desktop app checks for a newer release when it starts, tells the player on
the main menu, and — where the artifact allows it — downloads and installs one
in place. `electron/updater.cjs` is all of it.

**The feed already existed.** Every release the workflow cuts publishes
`latest.yml` / `latest-mac.yml` / `latest-linux.yml` next to the artifacts,
because that is what `electron-builder --publish` does. That is precisely what
`electron-updater` consumes, so the check needed no new publishing at all. One
asset was added, for one reason, below.

**Two deliveries.** "Install in place" is not available on every artifact this
project ships, and a Download button that silently does nothing on three of five
downloads would be worse than no button:

```
Windows NSIS      in-place   unsigned is fine; SmartScreen warns, as it does today
Linux AppImage    in-place   electron-updater swaps the AppImage
macOS             manual     Squirrel.Mac verifies the incoming bundle's signature
                             against the running app's, and EverRoad is unsigned
                             (§16.7). Not a bug to fix; a certificate to buy.
Windows portable  manual     target unsupported by electron-updater
Linux rpm         manual     likewise
```

The mode is detected from `PORTABLE_EXECUTABLE_DIR` and `APPIMAGE`, which
electron-builder's own launchers set, so it identifies the *artifact the user
downloaded* rather than guessing from the platform. The manual path is not "go
find it yourself": the same file the feed names is downloaded, its SHA-512
checked against the feed's, written to Downloads and revealed in the file
manager. Only the last click is the player's.

**Which file the manual path downloads is a second decision, and it is not
`files[0]`.** `latest-*.yml` lists every artifact for the platform, so the feed
alone does not say which one this machine wants. Two axes matter. Architecture:
`latest-mac.yml` lists x64 first, so taking the first entry handed every Apple
Silicon user the Intel build. Package format: both Linux artifacts are named
`linux-x86_64`, so both survive the arch filter and the AppImage — listed first
— went to rpm users, who got a 128 MB file their package manager cannot
install. `pickFile` therefore filters by arch token, then by format:
`.dmg` over `.zip` on macOS, and on Linux whichever of `.AppImage` / `.rpm`
matches `linuxPackageFormat()`. That reads `APPIMAGE` first, since the AppImage
runtime sets it and it is proof rather than inference, and otherwise looks for
an rpm database — an extracted AppImage run without its launcher has no
`APPIMAGE` set, and handing that user an `.rpm` would be the same bug one step
over. With neither signal it falls back to the AppImage, which runs anywhere.

**`release-meta.json`, and why a version number is not enough.** The one thing
the feed cannot answer is the question worth asking before pressing Download:
*will this still read my journey?* `SAVE_VERSION` is a compile-time constant
baked into each bundle, so an old build cannot see the new one's value, and
EverRoad is pre-1.0 — a patch bump is explicitly allowed to move the save
format. So each release publishes its own `SAVE_VERSION` as a small JSON asset
(`scripts/build-release-meta.mjs`, uploaded by the `guard` job), the updater
fetches it for the offered version, and the renderer compares it against its
own. Higher means the warning banner. A release cut before this existed carries
no such asset and reads as **unknown**, which the UI says out loud rather than
flattening into "safe" — a warning that goes quiet when it does not know is a
warning nobody can rely on.

The warning's wording is exact about something easy to get wrong: an update does
not wipe a save. The appId does not change, so the new build reads the same
storage. The risk is narrower — a release that raises `SAVE_VERSION` may not be
able to read the old shape, and once it autosaves, the old shape is gone.
`loadGame`'s newer-save parking (§9) protects a *downgrade*; nothing protects the
save an upgrade already overwrote. Hence the advice is to export, stated as the
copy that actually survives.

**Where the network is.** All of it is in the main process. The renderer's CSP
still pins `connect-src 'self'` and gains no exception: the page asks the main
process what it found and renders the answer. Every outbound byte in the
application is in `updater.cjs`, and the check is renderer-*initiated* — the main
process never reaches the network on its own, so the Settings toggle means no
request is made rather than one made and discarded.

**Five verbs, no arguments.** `check`, `download`, `install`, `reveal` and
`openReleasePage` each act on state the main process derived from the feed
itself. There is no URL, path or version for the renderer to supply, and
therefore none for a compromised page to choose; the worst a subverted page can
do is ask for an update that was already on offer. That is also why the release
page — the app's one real outbound link — is opened by `updater.cjs` from a URL
built out of its own constants, rather than by relaxing the `openExternal` ban in
§16.2 to a host allowlist.

**One packaging consequence.** `electron-updater` is real runtime code in the
main process, so the blanket `!node_modules` exclusion in electron-builder.yml
had to go and `dependencies` in package.json became load-bearing. `three` and
`postprocessing` moved to `devDependencies` in the same change: Vite inlines both
into `dist/` at build time, and leaving them listed as runtime dependencies would
have shipped a second, unreferenced copy of Three.js inside every download.

**Its limits, stated.** The check reads a public feed anonymously; a private
repository would need a token the client cannot carry. macOS auto-install waits
on an Apple Developer certificate and nothing else. And the end-to-end path can
only be proven by two real releases — a local `npm run verify` proves the
decision logic and the packaging, not the handoff.

---

*This document evolves with the implementation.*
