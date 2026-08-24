# Changelog

All notable changes to Everroad are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and Everroad follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Everroad is pre-1.0: the `0.MINOR.PATCH` line means the public surface — the
save format above all — is still allowed to move, and every shipped change
lands as a patch bump until the game reaches a deliberate 1.0.

This file is the **source of truth** for in-game patch notes. `npm run
changelog` parses it into `src/version/changelog.generated.ts`, which the
What's New panel renders; CI fails if the two drift apart. Edit this file, not
the generated module.

## [Unreleased]

## [0.1.17] - 2026-08-24

### Added

- Everroad now ships as a **desktop app**. Release builds are wrapped in
  Electron and published to GitHub Releases for macOS (Apple silicon and Intel),
  Windows (installer or portable) and Linux (AppImage, or an RPM for
  Fedora/RHEL). The browser build is unchanged and remains how the game is
  developed.
- **What's New** — a button in the top-right of the main menu opens the full
  patch notes, newest release expanded.
- The build number sits in the bottom corner of the main menu and the settings
  panel, so a bug report can always name the build it came from.
- **Quit to Desktop** in settings, shown only in the desktop app. The browser
  build still quits to the main menu, because a tab cannot close itself.

### Changed

- Versioning is now semantic and retroactive: this changelog reconstructs the
  project's history from its commits, and every build from here on carries a
  version number you can quote in a bug report.

## [0.1.16] - 2026-08-24

### Added

- **The main menu.** The game no longer boots straight into driving. Continue
  (with a live summary of your journey), New Journey (which asks twice before
  erasing one) and Settings sit over live in-engine footage — a real car on a
  real road, re-rolled from the whole catalog each time you arrive, in a random
  biome at a flattering hour, with eight directed camera shots cutting every
  7–11 seconds.
- **Quit to Main Menu** in settings. It saves your journey first.

### Fixed

- Sitting on the main menu no longer paid offline earnings. Quitting to the
  menu stamped a save, so an overnight title screen paid out a full night.
- New Journey silently reset your audio and graphics settings.
- A panel opened over the menu left the buttons behind it keyboard-live with an
  invisible focus ring — Enter dropped you into gameplay with the panel still up.
- A stray "Relic found!" toast could leak out of the attract-mode footage into a
  fresh journey.
- The offline-earnings modal survived a quit to the menu.

## [0.1.15] - 2026-08-24

### Fixed

- Removed the high-pitched whine that played during an aurora. It was a pair of
  bare sine tones three octaves above the biome's root — consonant with the key,
  and still effectively a siren. Auroras are now visual-only.

## [0.1.14] - 2026-08-24

### Fixed

- The aurora no longer cuts off at a hard edge, and no longer pops as it
  crossfades between episodes.
- The world no longer runs out past the edge of the terrain ribbon. A distant
  land backdrop fills the horizon, so grazing sight lines find ground instead of
  sky — the "floating trees" report.

## [0.1.13] - 2026-08-24

### Fixed

- Shadows are anchored to the things casting them. A shadow bias measured in
  metres rather than texels had been displacing every shadow lookup by 2.2 m,
  walking shadows clean off their casters.
- Shadows no longer stretch to the horizon around dawn and sunset.
- Trees, rocks and props sit on the ground as drawn instead of hovering above or
  sinking into it, and lean with the slope they stand on.

## [0.1.12] - 2026-08-24

### Fixed

- Wheels roll about their axle instead of flailing in the wheel well. They had
  been castoring flat since the first build.

## [0.1.11] - 2026-08-24

### Added

- The starter car, the Rusty Hatch, is now a handcrafted model — repainted faded
  beige, and 47% lighter than the procedural one it replaces.

## [0.1.10] - 2026-08-24

### Added

- A Blender-to-bundle pipeline for handcrafted models. Procedural generation
  stays the default for every asset; a handcrafted model exists only where one
  was asked for. Nothing is fetched at runtime.

## [0.1.9] - 2026-08-24

### Changed

- Work now reaches the main branch only through a CI-green pull request, behind
  six checks: formatting, types, tests on Node 20 and 22, build and bundle
  budget, and a dependency audit.

## [0.1.8] - 2026-08-24

### Fixed

- A non-finite combo multiplier could permanently poison your coin totals.
- Offline earnings returned nonsense when the stored save time was not a number.
- Ten further backlog defects across the world, economy, save and UI.

## [0.1.7] - 2026-08-24

### Fixed

- Nineteen defects found in a full audit of the world, economy, save system and UI.

## [0.1.6] - 2026-08-24

### Changed

- The HUD odometer now reads as journey miles, so it cannot be mistaken for the
  lifetime total.

## [0.1.5] - 2026-08-24

### Fixed

- Speed is capped at the car's stated limit. Holding W tops out where the spec
  sheet says it should, and autopilot cruises at 94% of it.
- Removed the pitched engine hum. The noise-only rumble bed stays.

## [0.1.4] - 2026-08-24

### Fixed

- Steering was inverted.
- The camera orbited instead of turning with the car.
- The terrain was wound inside out after an axis flip.
- Removed the idle camera sway.

## [0.1.3] - 2026-08-24

### Added

- Coin pickups play a run up the scale — major, minor or lydian, in the biome's key.

## [0.1.2] - 2026-08-24

### Added

- Autopilot holds the right lane.

### Fixed

- The combo meter and the coin magnet no longer tick over while the game is idle.

## [0.1.1] - 2026-08-24

### Fixed

- Road dash markings bled into one another.
- The game ran in slow motion after the tab lost focus.

### Changed

- Art tuning: saturation, shadows and tree placement.

## [0.1.0] - 2026-08-24

### Added

- **The first playable build of Everroad.** A procedurally generated country
  highway that scrolls forever through painted biomes: driving, the road, chunk
  streaming, biomes, sky and day/night, weather, scenery and pickups.
- Economy, upgrades, the car catalog, prestige and achievements.
- A generative audio engine, the HUD and panel overlay, and a save system that
  keeps earning while you are away.

[Unreleased]: https://github.com/Troll-Phace/everroad/compare/v0.1.17...HEAD
