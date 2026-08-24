# Everroad — UI Module

DOM/CSS overlay rendered inside `#ui-root`. No Three.js; everything imports only
from `src/types.ts` and files within `src/ui/`. Entry point:

```ts
import { initUI } from './ui/ui';
initUI(deps); // deps: UIDeps from types.ts
```

## File layout

| File | Role |
|------|------|
| `src/ui/ui.ts` | Entry point: mounts HUD/effects/panels, global keyboard handling, first-run help |
| `src/ui/ui.css` | All UI styles (imported by `ui.ts`); builds on the glass CSS variables in `src/style.css` |
| `src/ui/hud.ts` | Corner HUD + the requestAnimationFrame update loop |
| `src/ui/panels.ts` | `PanelManager` — one center glass card at a time, open/close/refresh lifecycle |
| `src/ui/panelGarage.ts` … `panelHelp.ts` | One module per panel (garage, upgrades, trophies, prestige, settings, help) |
| `src/ui/effects.ts` | Toasts, biome banner, offline-summary modal, prestige flash |
| `src/ui/dom.ts` | DOM helpers (`el`, change-detecting `textUpdater`/`classToggler`, `replayAnimation`) |
| `src/ui/icons.ts` | Emoji maps for currencies, time-of-day, weather |

## Layout

`#ui-root` is `position:fixed; inset:0; pointer-events:none`. Interactive
surfaces (buttons, panel layer, modal overlay, form controls) opt back in with
`pointer-events:auto`.

- **Top-left** — currency stack: 🪙 coins + `+X/s` rate (from `runtime.coinRate`);
  🌅 tokens and 🍁 relics rows stay hidden until first earned (then never re-hide).
- **Top-right** — biome name (`BIOME_NAMES[runtime.biomeId]`), time-of-day icon
  (🌅🌞🌇🌙), weather icon when not clear (🌧️🌫️🍂✨), fps chip when
  `settings.showFps`.
- **Bottom-left** — speedometer: big mono mph, AUTO/MANUAL pill
  (`runtime.isActive`), glowing DRIFT pill (`runtime.isDrifting`).
- **Bottom-center** — combo meter: hidden at `combo <= 1`; shows `×N.N` with a
  thin draining bar. The engine exposes no max combo duration, so the bar drains
  against the high-water mark of `comboTimer` seen since the combo started.
  Pulses (scale animation) whenever the multiplier increases.
- **Bottom-right** — journey odometer (1 decimal), lifetime miles, and trophy
  progress `unlocked/total 🏆`.
- **Top-center** — toast stack; below it the biome banner layer; modal and
  prestige-flash layers sit on top.

The HUD updates in a single rAF loop that re-reads `deps.state` / `deps.runtime`
every frame (they are live objects) and only writes to the DOM when the
displayed string/class actually changes.

## Keyboard

| Key | Action |
|-----|--------|
| G / U / T / P / H | Toggle garage / upgrades / trophies / prestige / help |
| Esc | Close the open panel, or open Settings if none is open |
| M | Toggle audio (`actions.setAudioEnabled`) + confirmation toast |

Keys are ignored while an `input`/`textarea`/contenteditable has focus (save
import box), and when Ctrl/Cmd/Alt are held. Pressing an open panel's key closes
it. On every open/close the manager sets `document.body.dataset.panel` to the
panel id (or deletes it) and emits `uiPanelChange` on the bus, so the engine can
dim gameplay input while a panel is up.

## Panels

All panels are center-screen glass cards (`max-height: 80vh`, scrollable
content, header with title + key hints, scale+fade entrance). Clicking the
dimmed backdrop closes them. Panels with live numbers return an updater from
`render()`; the manager runs it every 250 ms while open (affordability,
progress bars) without rebuilding the DOM. `purchase` and `carSelected` bus
events trigger a full re-render of whichever panel is open, preserving scroll
position.

1. **Garage (G)** — car cards sorted by tier then cost: swatch pair
   (body/accent color), name, tier stars, speed, coin mult, flavor text.
   States: selected (accent ring, "Driving"), owned (Select →
   `actions.selectCar`), affordable (Buy → `actions.buyCar`), locked (dimmed,
   disabled Buy).
2. **Upgrades (U)** — current car header; the five part rows from
   `catalogs.upgrades` with level `Lv n/max`, description, per-level effect,
   cost via `actions.getUpgradeCost`, Buy via `actions.buyUpgrade` (disabled
   when unaffordable; MAX when capped). Below a divider, the **Horizon Shop**
   (token upgrades via `buyGlobalUpgrade`/`getGlobalUpgradeCost`) — replaced by
   a teaser line until `stats.prestigeCount > 0` or tokens exist.
3. **Trophies (T)** — progress bar header, category filter chips (All + the 8
   categories), grid of achievement cards. Locked = grayscale/dim; secret +
   locked shows `???` with hidden description and a ❔ icon; unlocked = accent
   glow + reward line. The grid is **built once and cached**; `achievement`
   events patch unlock states in place (even while closed).
4. **Prestige (P)** — explanation, journey miles, live preview from
   `actions.getPrestigePreview()` (token gain, miles-required progress bar),
   and a BEGIN NEW JOURNEY button that requires a second click within 3 s
   ("Are you sure? …"). Calls `actions.prestige()`; the engine's `prestige`
   event drives the celebration.
5. **Settings (Esc)** — audio toggle (`setAudioEnabled`), music/SFX sliders
   (these mutate `state.settings.musicVolume` / `sfxVolume` directly — UIActions
   has no volume setters; the audio engine reads settings live), quality select
   (`setQuality`), Show FPS checkbox (mutates `settings.showFps`). Save
   section: Export (`exportSave` → read-only textarea + clipboard copy), Import
   (textarea → `importSave`, inline error on failure), Reset (`resetSave`,
   double-confirm within 3 s).
6. **Help (H)** — controls table + one-paragraph how-it-works. Auto-opens once
   for brand-new saves (`stats.playTimeSec < 5` at init).

## Bus events consumed

| Event | Response |
|-------|----------|
| `achievement` | Glassy toast per unlock (icon, "Achievement unlocked!", name, reward); trophies grid patched in place |
| `toast` | Generic small toast |
| `pickup` (kind `relic`) | "Relic found! 🍁" toast |
| `offlineSummary` | Welcome-back modal: `⏱ formatDuration(seconds) → 🪙 +coins` |
| `prestige` | Full-screen soft radial flash + "New Journey begins — +N 🌅" toast |
| `biomeChange` | Zelda-style area-title banner, fades in/out over ~2.6 s |
| `purchase`, `carSelected` | Re-render the open panel |

Emitted by the UI: `uiPanelChange` (on every panel open/close).

Toasts stack top-center, max 3 visible (extras queue), auto-dismiss after
4.5 s with a slide-out.

## CSS architecture

- Single stylesheet `ui.css`, imported by `ui.ts`. Consumes the base variables
  from `style.css` (`--glass-bg`, `--glass-border`, `--glass-blur`, `--accent`,
  `--accent-soft`, `--radius`, `--font-ui`, `--font-mono`, text colors) — the
  engine retints `--accent`/`--accent-soft` per biome and every accent in the
  UI follows automatically.
- `.panel-glass` is the shared glass recipe (blur, border, radius, shadow);
  `.hud` is a lighter variant for corners.
- Utility classes: `.hidden`, `.mono`, `.btn`(+`-accent`/`-ghost`/`-danger`/`-big`),
  `.chip`, `.pill`, `.key-hint`, `.progress-track`/`.progress-fill`.
- All transitions are ~0.25 s ease; entrances are short scale+fade keyframe
  animations (`panel-in`, `toast-in`, `combo-pulse`, `biome-banner`,
  `prestige-flash`).
- One `@media (max-width: 640px)` block tightens the HUD for small screens.
