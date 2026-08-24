# 🌄 EverRoad

*An idle infinite driving game. Drive through a painted countryside forever.*

The grind of RuneScape × an endless runner × a pastel Breath-of-the-Wild painting.
Your car cruises an endless winding highway through blended biomes — emerald meadows,
amber farmland, ember-red autumn forests under god-ray sunsets. Stats accumulate,
achievements unlock, cars and upgrades collect. Runs entirely in the browser.

## Play

```bash
npm install
npm run dev
```

Then open the printed localhost URL.

- The car **drives itself** — watch, or press **WASD/arrows** to take the wheel for
  pickups, drifts (hold **Shift**), and near-miss bonuses.
- **G** garage · **U** upgrades · **T** trophies · **P** prestige · **H** help ·
  **M** mute · **Esc** settings/close
- Progress is saved locally and accrues **while you're away**.

## Desktop app

EverRoad also ships as a desktop app for macOS, Windows and Linux. Grab the
latest build from the
[Releases page](https://github.com/Troll-Phace/everroad/releases).

The desktop builds are **unsigned** — there is no Apple or Windows code-signing
certificate for this project — so the first launch needs a nudge:

- **macOS** — right-click the app → **Open** → **Open**. After once, it opens normally.
- **Windows** — SmartScreen shows "Windows protected your PC"; choose **More info** → **Run anyway**.
- **Linux** — `chmod +x EverRoad-*.AppImage`, then run it.

The desktop app is the same game as the web build, wrapped in Electron. **The
browser is the primary way to run and develop EverRoad**; `npm run dev` above is
unaffected by any of the packaging.

## Build

```bash
npm run verify    # typecheck + tests + build (what CI and the pre-push hook check)
npm run build && npm run preview

npm run electron:dir     # unpacked desktop app in release/ — the fast check
npm run electron:build   # real installers in release/, publishes nothing
```

Releases are cut by pushing a `vX.Y.Z` tag; see
[docs/RELEASING.md](docs/RELEASING.md).

## Docs

- [Game Design Document](docs/GDD.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Releasing](docs/RELEASING.md)
- [Economy tuning](docs/ECONOMY.md)
- [Achievements list](docs/ACHIEVEMENTS.md)
- [Design system](docs/DESIGN_SYSTEM.md)
- [Build log](docs/BUILDLOG.md)
- [Changelog](CHANGELOG.md)

## Stack

Three.js · postprocessing (god rays/bloom) · Vite · TypeScript · Web Audio (generative,
zero audio files) · Electron for the desktop builds · zero backend, zero external assets.

## License

EverRoad is released under the [MIT License](LICENSE) — © 2026 Troll-Phace.
You may use, copy, modify and redistribute it, including commercially, as long
as the copyright notice and licence text travel with it.

The bundled typefaces — **Quicksand** and **JetBrains Mono** — are *not* MIT.
Both are SIL Open Font License 1.1, and their licence texts ship alongside them
in `public/fonts/`. See
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
