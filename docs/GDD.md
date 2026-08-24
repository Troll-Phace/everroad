# Everroad — Game Design Document

*An idle infinite driving game. Drive through a painted countryside forever.*

## Pitch

The grinding satisfaction of RuneScape meets an endless runner, with a car theme.
Your car cruises an infinite winding country highway through pastel-painted biomes.
Stats accumulate passively; achievements unlock; cars and parts collect. You can watch
it like a living painting — or take the wheel and earn faster.

## Core loop (hybrid idle/active)

- **Autopilot (default):** the car drives itself down the center of the road forever.
  Coins accrue per mile at the base rate.
- **Take the wheel:** touching WASD / arrow keys engages manual steering. While active:
  - **Pickups** — coin lines and arcs float on the road; weave to collect.
  - **Drifting** — hold Shift while steering at speed to drift; builds combo multiplier.
  - **Near-misses** — pass close to roadside objects (hay bales, fences, logs) for style bonuses.
  - A **combo multiplier** (up to caps set by Tires upgrades) multiplies coin earnings.
  - No fail state. Sloppy driving just earns slower.
- **Release the wheel** for ~4 seconds and autopilot smoothly resumes.
- **Offline:** full offline progress at the idle rate. A "While you were away" summary
  greets returning players.

## Controls

| Key | Action |
|-----|--------|
| W/A/S/D or Arrows | Steer (engages active mode); W/S nudge speed |
| Shift (hold) | Drift while steering |
| G | Garage (cars) |
| U | Upgrades |
| T | Trophies / achievements |
| P | Prestige (New Journey) |
| M | Mute audio |
| H | Help / controls |
| Esc | Close panel / settings |

## Economy

Three currencies:

1. **Coins** — earned per mile (base rate × car coinMult × upgrades × combo × global
   multipliers). Spent on cars and per-car parts.
2. **Horizon Tokens** — prestige currency. "Begin a New Journey" resets journey miles,
   coins, and per-car part levels, granting tokens based on journey distance. Spent in
   the permanent Horizon shop (global multipliers, offline rate, starting speed...).
3. **Relics** — rare glowing roadside collectibles, biome-flavored (e.g. a maple charm
   in Emberwood). Spent on special cars; tracked for achievements.

**Pacing targets (cozy medium grind):**
- First car purchase: ~5–8 min. Two or three cars in the first hour.
- First prestige available at 25 journey miles, optimal around 30–45 min of play.
- Later tiers stretch to hours, then days. Exponential costs (~1.6–1.9× growth) vs.
  softly-exponential income (prestige-driven).

## Cars & upgrades

**Garage:** ~12 cars across tiers, from the free `rusty-hatch` to a late-game hover car.
Each car has a distinct procedural low-poly look (body type + palette) and stats
(baseSpeed, coinMult). Cars are permanent (survive prestige).

**Per-car parts** (reset on prestige): Engine (speed), Tuning (coin mult), Tires (drift
combo cap/rate), Magnet (pickup radius), Chime (relic find chance).

**Horizon shop** (permanent): global coin mult, offline earnings rate, combo duration,
starting coins after prestige, token gain mult, etc.

## World & art direction

**Look:** Breath of the Wild-inspired painterly pastel. Ultra-vibrant saturated colors,
soft 3-step toon shading, heavy atmospheric fog blending into gradient skies, god rays
at golden hour, bloom everywhere. Low-poly instanced scenery with painterly vertex-color
variation.

**The road:** an infinite, gently winding two-lane country highway with elevation
changes, procedurally generated from smooth noise; chunked and recycled.

**Biomes** (gradual blends, ~2 mile cycle segments, sequenced in a rotating loop):

| Id | Name | Palette | Signature |
|----|------|---------|-----------|
| meadow | Emerald Meadows | greens, white wildflowers | rolling hills, lone oaks |
| farmland | Amber Farmland | wheat golds | hay bales, fences, windmills |
| sunflower | Sunflower Coast | yellow/teal | sunflower fields |
| autumn | **Emberwood (HERO)** | deep oranges, reds | maple forests, falling leaves, biggest sunsets & god rays |
| pine | Mistpine Hills | teal/blue-green | tall pines, low fog |
| lavender | Lavender Reach | purples | lavender rows |
| cherry | Blossom Vale | pinks | cherry trees, petal drift |
| wetland | Dawnmarsh | soft blues/golds | reeds, water pools, mist |

**Day/night cycle:** ~10 real minutes per cycle with elongated dawn/sunset golden hours.
Night brings stars; the rare **aurora** weather paints the sky.

**Weather:** clear, rain, fog, falling leaves/petals (biome-flavored), aurora (night
only, rare). Weather affects mood/audio and feeds achievements (e.g. "drive 100 miles
in rain").

## Achievements

100+ achievements in tiered ladders (RuneScape-style completionist wall) across
categories: distance, wealth, garage, skill (drift/near-miss/combo), explorer
(biomes/weather/time), dedication (playtime/sessions/offline), prestige, and secrets.
Many grant small coin/token bounties. Unlocks pop as glassy toasts with a chime.

## Audio

Fully generative via Web Audio API (no audio files): evolving ambient pad chords keyed
to biome + time of day, wind/engine bed tied to speed, bird chirps by day, crickets at
night, rain noise, soft UI chimes and pickup plinks. Mutable; volumes in settings.

## UI

Minimal glassy overlay: translucent blurred panels, rounded corners, accent color tinted
by current biome. HUD shows speed, odometer, coin rate, currencies, combo meter, biome
name + time-of-day icon. Panels (garage/upgrades/trophies/prestige/settings) summoned by
keys, world always visible behind.

## Persistence

localStorage autosave every ~5s and on tab close. Export/import save codes (base64).
Full offline progress computed from `lastSaveTime` on load.

## Tech

- **Three.js** + **postprocessing** (pmndrs) for god rays/bloom/vignette
- Vite + TypeScript, zero backend
- Save: localStorage; audio: Web Audio; no external assets (all procedural)
