# 🌄 Everroad

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

## Build

```bash
npm run build && npm run preview
```

## Docs

- [Game Design Document](docs/GDD.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Economy tuning](docs/ECONOMY.md)
- [Achievements list](docs/ACHIEVEMENTS.md)
- [Build log](docs/BUILDLOG.md)

## Stack

Three.js · postprocessing (god rays/bloom) · Vite · TypeScript · Web Audio (generative,
zero audio files) · zero backend, zero external assets.
