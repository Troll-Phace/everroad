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
| `src/ui/ui.ts` | Entry point: mounts menu/HUD/effects/panels, global keyboard handling, app-mode wiring, first-run help |
| `src/ui/mainMenu.ts` | Main menu over attract-mode footage (Continue / New Journey / Settings) |
| `src/ui/transition.ts` | The mode fade — the full-screen cover every `startGame`/`quitToMenu` runs behind |
| `src/ui/confirm.ts` | `armConfirm` — two-step arm-and-confirm for destructive buttons |
| `src/ui/ui.css` | All UI styles (imported by `ui.ts`); builds on the glass CSS variables in `src/style.css` |
| `src/ui/hud.ts` | Corner HUD + the requestAnimationFrame update loop |
| `src/ui/panels.ts` | `PanelManager` — one center glass card at a time, open/close/refresh lifecycle |
| `src/ui/panelGarage.ts` … `panelHelp.ts` | One module per panel (garage, upgrades, trophies, prestige, settings, help) |
| `src/ui/effects.ts` | Toasts, biome banner, offline-summary modal, prestige flash |
| `src/ui/dom.ts` | DOM helpers (`el`, change-detecting `textUpdater`/`classToggler`, `replayAnimation`) |
| `src/ui/icons.ts` | Emoji maps for currencies, time-of-day, weather |

## App modes

`runtime.appMode` is `'menu'` or `'playing'`. `ui.ts` mirrors it onto
`document.body.dataset.appmode` (the same precedent as `dataset.panel`) on every
`appModeChange`, and reads `deps.runtime.appMode` once at mount so the initial
menu shows even if the engine's first emit beat the subscription.

In `menu` mode the HUD and the biome banner are hidden in CSS
(`body[data-appmode='menu']`), the HUD's rAF loop early-outs before doing any
per-frame work, and the panel hotkeys (G/U/T/P/H) are ignored. `M` (mute) and
`Esc` (Settings) still work; `Esc` is additionally ignored while
`transition.busy`, so a fade already in flight cannot deliver the player into
gameplay with Settings open.

`applyMode` closes any open panel on **both** transitions, not just on the way
into the menu — a panel opened over the title screen has no business surviving
into the journey. Entering `menu` additionally calls `effects.clearTransient()`,
which tears down the offline-summary modal, empties the toast stack and cancels
the biome banner.

The toast stack itself is **not** hidden on the menu. Hiding it made attract-mode
toasts invisible rather than absent, and a toast lives 4.5 s, so one raised
behind the title screen was still on screen inside the journey the player
started next. Game-driven toasts (`toast`, `achievement`, `pickup`, `prestige`)
and the biome banner are instead gated on `runtime.appMode === 'playing'` at
their source in `effects.ts`. The exported `Effects.toast` stays ungated: it
carries player-initiated feedback (`M`, "save code copied", "save imported")
that has to be visible wherever the player pressed the key.

A panel opened over the menu sets `inert` on `.menu-inner` (from `mainMenu.ts`'s
`uiPanelChange` subscription). That, not the CSS recede, is what takes the three
action slabs out of the tab order — `pointer-events: none` on the column does
not work, because `.btn` sets `pointer-events: auto` and re-establishes each
button as a hit target under a `none` ancestor.

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
| G / U / T / P / H | Toggle garage / upgrades / trophies / prestige / help (**gameplay only**) |
| ↑ / ↓ | Move between the main menu's buttons (menu only) |
| Esc | Close the open panel, or open Settings if none is open (ignored during a mode fade; dismisses the offline modal when it is up) |
| M | Toggle audio (`actions.setAudioEnabled`) + confirmation toast |

Keys are ignored while an `input`/`textarea`/contenteditable has focus (save
import box), and when Ctrl/Cmd/Alt are held. Pressing an open panel's key closes
it. On every open/close the manager sets `document.body.dataset.panel` to the
panel id (or deletes it) and emits `uiPanelChange` on the bus, so the engine can
dim gameplay input while a panel is up.

Opening a panel moves focus into the card (`role="dialog"`, `aria-modal`,
`tabindex="-1"`, labelled by its own `<h2>`) and Tab/Shift+Tab wrap inside it;
closing hands focus back to whatever held it before, after `uiPanelChange` has
fired so the restore target is no longer inert. The offline-summary modal
follows the same contract: focus lands on its button, Esc dismisses it (captured
on `window` and stopped, so the global Esc does not also open Settings behind
it), and focus returns to where it was.

## Main menu

`src/ui/mainMenu.ts`, mounted **before** everything else in `#ui-root` so the
later-appended panel layer paints above it and Settings opens over the menu. The
layer is `pointer-events: none`; only the buttons opt back in.

Left-anchored column (bottom sheet under 640px): the **EVERROAD** wordmark and
the "the road goes on forever" tagline echoing the loading screen, three
`.menu-btn` slabs, and a dim footer of key hints. See DESIGN_SYSTEM §1.4 for how
legibility is held over footage that runs from night to sunset, and §4.8 for the
slab.

1. **Continue** — primary when a save exists. Sub-lines come from
   `actions.getSaveSummary()`: `journey mi · 🪙 coins · car name · Journey N`
   (the last only past a prestige), plus a `last driven 2h 14m ago` line
   refreshed every 30 s while the menu is up. With no save it is **disabled with
   the reason shown** ("No journey yet") rather than hidden, and New Journey
   takes `.is-primary`.
2. **New Journey** — `actions.startGame('new')`. When `actions.hasSave()` it
   arms and confirms through `armConfirm` (same 3 s window and danger styling as
   Reset save); with nothing to lose it starts on a single click.
3. **Settings** — opens the existing panel over the menu.

Up/Down cycle the enabled buttons (Tab also works, Enter/Space activate
natively); focus lands on the primary button on mount, delayed at boot so it
happens as the loading screen lifts. Arrow handling stands down while a panel is
open. The menu re-reads the save whenever a panel closes, since Import and Reset
can change it out from under the title screen.

A one-time staggered entrance (`menu-rise`, delayed 0.35–0.95 s) times the menu
to the loader's fade; returns from gameplay arrive behind the fade cover and
need no entrance.

## The mode fade

`actions.startGame()` and `actions.quitToMenu()` are synchronous and
instantaneous, so the entire visible transition belongs to the UI.
`createModeTransition()` (`src/ui/transition.ts`) mounts a `.mode-cover` on
`document.body` (z-index 90, under the loading screen) and `run(swap)`:

1. fades to black over 320 ms,
2. calls `swap()` — the one `startGame`/`quitToMenu` call — under the opaque cover,
3. fades back in over 500 ms.

While it runs the cover takes pointer events and `transition.busy` is true, so
neither a click nor a keyboard activation can fire a second transition. Under
`prefers-reduced-motion` the timings shorten to 90/120 ms; the cover is never
skipped, because it is what hides the world being rebuilt.

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
   (`setQuality`), Show FPS checkbox (mutates `settings.showFps`). **Session**
   section (gameplay only — hidden while `runtime.appMode === 'menu'`): **Quit
   to Main Menu**, "Saves your journey first.", which closes the panel and calls
   `actions.quitToMenu()` through the mode fade. A browser tab cannot close
   itself, so quitting means returning to the menu and the copy says so. Save
   section: Export (`exportSave` → read-only textarea + clipboard copy), Import
   (textarea → `importSave`, inline error on failure), Reset (`resetSave`,
   double-confirm within 3 s).
6. **Help (H)** — controls table + one-paragraph how-it-works. Auto-opens once
   for a brand-new save (`stats.playTimeSec < 5`) on the **first transition into
   `playing`**, not on top of the main menu.

## Bus events consumed

| Event | Response |
|-------|----------|
| `achievement` | Glassy toast per unlock (icon, "Achievement unlocked!", name, reward); trophies grid patched in place † |
| `toast` | Generic small toast † |
| `pickup` (kind `relic`) | "Relic found! 🍁" toast † |
| `offlineSummary` | Welcome-back modal: `⏱ formatDuration(seconds) → 🪙 +coins` |
| `prestige` | Full-screen soft radial flash + "New Journey begins — +N 🌅" toast † |
| `biomeChange` | Zelda-style area-title banner, fades in/out over ~2.6 s † |
| `purchase`, `carSelected` | Re-render the open panel |

† Dropped unless `runtime.appMode === 'playing'`. Attract mode runs the real
world, so these events keep firing behind the title screen.

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
- The main menu lives in `ui.css`; the `.mode-cover` lives in `style.css`
  alongside `#loading-screen`, since both are full-screen shell layers outside
  `#ui-root`.
- All transitions are ~0.25 s ease; entrances are short scale+fade keyframe
  animations (`panel-in`, `toast-in`, `combo-pulse`, `biome-banner`,
  `prestige-flash`).
- One `@media (max-width: 640px)` block tightens the HUD for small screens.
