# Everroad — Design System

The overlay's visual contract. Token values live in `src/style.css`; component
recipes live in `src/ui/ui.css`. This document is the reference both are written
against — when a value here and a value in the CSS disagree, the CSS is the bug
unless the change was deliberate, in which case update this file in the same
edit.

The governing constraint: **the overlay sits on top of a bright, saturated,
constantly changing 3D world.** Every decision below follows from that. There is
no fixed page background to design against — the same panel is read over a pale
dawn sky and a near-black night, so contrast comes from the glass surface, not
from the world behind it.

## 1. Color

### 1.1 Tokens

Defined once on `:root` in `src/style.css`. Nothing in the UI hardcodes a color
that one of these covers.

| Token | Value | Role |
|-------|-------|------|
| `--glass-bg` | `rgba(20, 24, 38, 0.42)` | The surface every panel and HUD group sits on |
| `--glass-bg-strong` | `rgba(14, 16, 30, 0.62)` | Heavier glass for full-bleed surfaces carrying text straight over the world (main-menu buttons) |
| `--glass-border` | `rgba(255, 255, 255, 0.14)` | Hairline edge that separates glass from world |
| `--glass-blur` | `14px` | Backdrop blur; what makes text readable over detail |
| `--text-main` | `rgba(255, 255, 255, 0.94)` | Primary text |
| `--text-dim` | `rgba(255, 255, 255, 0.6)` | Secondary text, units, labels |
| `--accent` | `#ffb26b` (default) | **Retinted per biome at runtime** |
| `--accent-soft` | `rgba(255, 178, 107, 0.25)` | Accent fills, active states, glows |
| `--radius` | `14px` | Panel and HUD corner radius |
| `--scrim-rgb` | `6, 6, 16` | Scrim base as raw channels, so gradients vary alpha per stop |
| `--menu-ink` | `#fff7ec` | Title-screen warm white (the loading title's color, reused by the menu wordmark) |
| `--menu-ink-dim` | `rgba(255, 247, 236, 0.78)` | Secondary title-screen type — the tagline, the menu button sub-lines and the footer |

Page background is `#1a1626` — visible only before the canvas paints, and used
as the foreground color when a button fills with the accent.

### 1.2 The accent is not a constant

The engine rewrites `--accent` and `--accent-soft` every time the biome blend
moves, sampled from the same `blendColor` function the fog and sky use. Read the
variable; never snapshot the computed value at render time, or the panel stops
following the world.

Anything that must stay legible independent of biome — body text, disabled
states, destructive actions — uses the text tokens or the semantic colors below,
not the accent.

### 1.3 Semantic colors

| Role | Value | Where |
|------|-------|-------|
| Danger border | `rgba(255, 120, 130, 0.4)` | Reset save, destructive confirms |
| Danger text | `rgba(255, 190, 196, 0.9)` | `.btn-danger-ghost` |
| Track / inactive fill | `rgba(255, 255, 255, 0.2)` | Progress and combo tracks |
| Hover surface | `rgba(255, 255, 255, 0.16)` | `.btn:hover` |
| Scrollbar thumb | `rgba(255, 255, 255, 0.25)` | Panel content |

### 1.4 Scrims over live footage

The main menu is the one surface with **no panel around it**: brand type and
button slabs sit directly on attract-mode footage that runs from near-black
night to a blazing sunset. Legibility is built in three layers, and all three
are load-bearing — none of them alone survives the bright case:

1. **A directional scrim.** On desktop a `100deg` gradient from
   `rgba(var(--scrim-rgb), 0.88)` at the left edge down to `0.06` at 76%, plus
   a bottom band. It darkens only the column the text occupies and leaves the
   middle of the frame open, so the footage still reads as the point of the
   screen. On small screens it flips to a vertical gradient under a bottom
   sheet.
2. **Glass under every button** (`--glass-bg-strong`), so button text never
   depends on the scrim alone.
3. **Text shadow** on the free-standing wordmark, tagline and footer, which
   have no surface of their own.

### 1.5 Loading screen

The one place with a fixed palette, because no world exists yet: a vertical
gradient `#2b1e4e → #7a3b6e (45%) → #e8735a (80%) → #ffb26b`, title in
`#fff7ec` with a warm glow, fading out over 1.2 s once the scene is ready.

## 2. Typography

| Token | Stack |
|-------|-------|
| `--font-ui` | `'Quicksand', system-ui, sans-serif` |
| `--font-mono` | `'JetBrains Mono', ui-monospace, monospace` |

Both families ship **in the bundle**, from `src/fonts/` — the latin subset of
the variable font, one woff2 per family, declared in `src/style.css` with a
`font-weight` range and `font-display: swap`. Nothing is fetched from Google
Fonts, so the desktop build renders in the intended faces with no network. The
range is what the UI actually uses: Quicksand 400–700, JetBrains Mono 400–700.
Reaching for a weight outside it clamps silently instead of failing loudly, so
widen the `@font-face` range in the same commit as the design change.

The mono 700 is worth knowing about: the old Google Fonts request only fetched
400–600, so `.release-version` asked for 700 and silently matched down to 600.
The variable file answers 700 at no extra cost, so that label now renders as it
was authored.

The fallbacks in the stacks above still matter — they are what covers the
symbols neither family carries (`★ ⚙ ⚠ → ▸`) and every emoji in the biome,
weather and trophy copy.

`.mono` also sets `font-variant-numeric: tabular-nums` — every changing number
(speed, coins, odometer, timers) uses it, so digits do not jitter the layout as
they tick.

| Role | Size | Weight | Notes |
|------|------|--------|-------|
| Menu wordmark | `clamp(2.4rem, 6vw, 4.2rem)` | 700 | `letter-spacing: 0.3em`, `--menu-ink` |
| Speedometer | 2.4rem | 600 | `line-height: 1`, mono |
| Combo multiplier | 1.3rem | 600 | Accent colored |
| Journey odometer | 1.15rem | 600 | Mono |
| Panel title | 1.15rem | 700 | `letter-spacing: 0.05em` |
| Currency value | 0.95rem | 600 | Mono |
| Biome name | 0.9rem | 600 | `letter-spacing: 0.04em` |
| Menu button label | 1.05rem | 700 | `letter-spacing: 0.06em` |
| Big button | 0.95rem | — | `.btn-big` |
| Button | 0.85rem | — | |
| Section label | 0.75rem | — | Uppercase, dim |
| Chip | 0.75rem | — | |
| Unit / lifetime / fps | 0.7rem | — | `--text-dim` |
| Menu button sub-line | 0.75rem | 500 | `--menu-ink-dim` |
| Menu button meta / footer | 0.7rem | — | `--menu-ink-dim`; meta is mono |
| Key hint | 0.68rem | — | Mono |
| Mode / drift pill | 0.6rem | — | Uppercase |

Sizes are in `rem` so browser zoom and OS text scaling work. The loading title
and the menu wordmark are the two fluid values: `clamp(3rem, 9vw, 6rem)` and
`clamp(2.4rem, 6vw, 4.2rem)`.

## 3. Spacing, radius, and layout

Spacing is expressed in `rem` and `em` on a loose 0.15 step, tightening toward
the HUD corners and opening up inside panels.

| Context | Padding | Gap |
|---------|---------|-----|
| HUD group | `0.65rem 0.9rem` | `0.3rem` |
| HUD top-right row | — | `0.55rem` |
| Combo meter | `0.5rem 1.1rem` | — |
| Panel header | `1rem 1.3rem 0.8rem` | — |
| Panel content | `1.1rem 1.3rem 1.3rem` | — |
| Card grid | — | `0.8rem` |
| Button | `0.5em 1em` | — |
| Big button | `0.85em 1em` | — |
| Menu button | `0.95rem 1.15rem 0.95rem 1.4rem` | `0.7rem` between slabs |
| Menu column | `2rem 1.5rem 2rem clamp(1.5rem, 6vw, 5rem)` | `clamp(1.5rem, 4vh, 2.6rem)` |
| Chip | `0.3em 0.9em` | — |
| Key hint | `0.15em 0.5em` | — |

HUD groups are inset `1rem` from their corner.

| Radius | Used for |
|--------|----------|
| `var(--radius)` (14px) | Panels, HUD groups |
| `10px` | Buttons |
| `12px` | Menu button slabs |
| `8px` | Selects |
| `6px` | Key hints, scrollbar thumb |
| `3px` | Progress tracks |
| `2px` | Combo track, loading bar |
| `999px` | Chips, pills |

Panels are center-screen cards capped at `max-height: 80vh` with the content
region scrolling and a 6px custom scrollbar.

## 4. Components

### 4.1 `.panel-glass` / `.hud`

The two glass recipes. `.panel-glass` is the full-strength surface — blur,
border, radius, drop shadow — used by panel cards and modals. `.hud` is the
lighter corner variant with the same tokens and less presence, so the HUD reads
as part of the world rather than as a window over it.

Every new surface uses one of these two. A third glass recipe is a design
regression.

### 4.2 Buttons

| Class | Appearance | Use |
|-------|-----------|-----|
| `.btn` | Translucent white surface, hairline border | Default action |
| `.btn-accent` | Accent border; fills with `--accent` on hover, text `#1a1626` | Primary action (Buy, Select) |
| `.btn-ghost` | Transparent | Tertiary, in-panel navigation |
| `.btn-big` | Larger padding and size | Prestige commit, single-focus actions |
| `.btn-danger` / `.btn-danger-ghost` | Red-tinted border and text | Reset, destructive confirms |

States: hover lifts `translateY(-1px)` and brightens the surface; active returns
to `translateY(0)`; disabled drops to `opacity: 0.4` with `cursor: default`.
Affordability is communicated by the disabled state, never by hiding the button
— the player should always be able to see what a thing costs.

Destructive and irreversible actions (prestige, reset save) require a second
click within 3 seconds, with the button relabeling itself to state what will
happen.

### 4.3 `.chip`

Pill-shaped filter control, dim by default, brightening on hover.
`.chip.is-active` takes the accent. Used for the trophy category filters.

### 4.4 `.pill`

Small uppercase status badge. `.pill-mode` shows AUTO or MANUAL, with
`.pill-manual` accent-tinted so the player can see at a glance who is driving.
`.pill-drift` glows on a 0.9 s `drift-glow` alternating animation while drifting.

### 4.5 `.key-hint`

Monospace keycap in the panel header, showing the key that opens and closes the
panel. Every panel exposes its own key this way; that is the only discovery
mechanism besides the help panel.

### 4.6 `.progress-track` / `.progress-fill`

3px accent-filled bar, width transitioning over 0.25 s. Used for trophy
progress, prestige mile progress, and upgrade caps. The combo meter uses its own
2px `.combo-track` / `.combo-fill` pair because it drains rather than fills.

### 4.7 Form controls

`.toggle` (18×18 checkbox), `.slider` (160px range), and `.select` all set
`accent-color: var(--accent)` so native controls follow the biome too, and all
set `pointer-events: auto` explicitly — they live inside a layer that has them
turned off.

### 4.8 `.menu-btn`

The main menu's action slab: full-width, `.btn` + `.panel-glass` composed with
`--glass-bg-strong` and a 12px radius, holding a bold label plus one or two
quiet sub-lines (the save summary, the "last driven …" line, a one-line
description). A 3px `.menu-btn-rail` on the leading edge takes the accent and
appears on hover, focus, and on `.is-primary`; hover adds an accent-tinted wash
and nudges the slab 4px right. Focus draws an accent outline backed by a dark
ring so it survives a sky the same color as the accent.

Disabled slabs deliberately do **not** take the standard `opacity: 0.4` — that
would fade out the reason the control is unavailable. They keep full opacity
with muted text and state the reason in the sub-line ("No journey yet").

### 4.9 Cards

`.car-card` and the trophy cards share a grid (`gap: 0.8rem`) and a common
anatomy: identity at the top, stats in the middle, action at the bottom. Locked
trophies render grayscale and dim; secret-and-locked shows `???` with a hidden
description; unlocked takes an accent glow and a reward line.

## 5. Motion

| Animation | Duration | Easing |
|-----------|----------|--------|
| Standard transition (color, border, transform, width) | 0.25s | `ease` |
| `panel-in` | 0.28s | `cubic-bezier(0.2, 0.9, 0.3, 1.1)` |
| `combo-pulse` | 0.35s | `ease` |
| `drift-glow` | 0.9s | `ease-in-out`, infinite alternate |
| `toast-in` | ~0.25s | `ease` |
| Toast lifetime | 4.5s | then slide-out |
| `biome-banner` | ~2.6s | fade in, hold, fade out |
| `prestige-flash` | one-shot radial | |
| Loading screen fade | 1.2s | `ease` |
| `menu-rise` / `menu-fade` (menu entrance) | 0.9s / 1.1s | `ease`, staggered 0.35→0.95s so it lands as the loader lifts |
| Mode fade out (before a `startGame`/`quitToMenu` swap) | 0.32s | `ease` |
| Mode fade in (after the swap) | 0.5s | `ease` |

Motion is confirmation, not decoration: something moves because state changed.
The combo meter pulses when the multiplier actually rises; the drift pill glows
only while drifting.

The **mode fade** (`.mode-cover`, `src/ui/transition.ts`) is the exception to
"motion is confirmation": `startGame()` and `quitToMenu()` are synchronous and
instantaneous, so the cover is the entire visible transition and it also hides
the world being torn down and rebuilt. Under reduced motion it is *shortened*
(90ms / 120ms), never removed — dropping it would expose a hard visual snap
rather than remove motion. While it runs it takes pointer events, which is also
what makes a menu button impossible to double-fire.

**Reduced motion.** `@media (prefers-reduced-motion: reduce)` drops keyframe
entrances and the drift glow to a plain opacity change and shortens transitions
toward instant. No information is carried by motion alone — the drift pill is
still visibly present without its glow, and the combo value is readable without
the pulse.

## 6. Accessibility

- **Contrast.** Body text is `rgba(255,255,255,0.94)` on the glass surface,
  which clears WCAG AA (4.5:1) against the darkest and the brightest skies the
  world produces. Check new text against a pale dawn, not only against night —
  that is the failing case. `--text-dim` at 0.6 alpha is for supporting text
  only; it does not carry information that appears nowhere else. The main menu
  is the worked example: its button sub-lines and footer *look* like supporting
  text but are the only statement of the save summary, the reason a disabled
  Continue is disabled, and the menu's key bindings — the HUD that would
  otherwise repeat any of it is `display: none` there — so they take
  `--menu-ink-dim` (0.78) rather than `--text-dim`.
- **Keyboard.** Every panel opens and closes by key, Esc closes the open panel
  or opens settings when none is open, and pressing an open panel's own key
  closes it. Focus indicators are visible on every interactive element. A
  control that has been visually receded behind a modal surface must also be
  made unreachable — a faded focus outline is an invisible focus indicator, and
  the outline is the only one there is. `inert` is the mechanism; a
  `pointer-events: none` ancestor is not, because `.btn` sets
  `pointer-events: auto` and re-establishes itself as a hit target underneath
  one.
- **Focus trapping.** Opening a panel or the offline-summary modal moves focus
  into it and Tab wraps inside; closing returns focus where it came from. Both
  carry `role="dialog"`, `aria-modal="true"` and an `aria-labelledby` pointing
  at their own heading. While a text field has focus (the save import box),
  panel hotkeys are ignored, as they are while Ctrl/Cmd/Alt are held.
- **Pointer surface.** `#ui-root` is `pointer-events: none`; only interactive
  elements opt back in. The world stays clickable everywhere the UI is not.
- **Motion sensitivity.** See §5.
- **No color-only meaning.** AUTO/MANUAL, locked/unlocked, and affordable/not
  each carry a label or a disabled state alongside the color difference.

## 7. Machine-readable tokens

```css
:root {
  --font-ui: 'Quicksand', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, monospace;
  --glass-bg: rgba(20, 24, 38, 0.42);
  --glass-border: rgba(255, 255, 255, 0.14);
  --glass-blur: 14px;
  --text-main: rgba(255, 255, 255, 0.94);
  --text-dim: rgba(255, 255, 255, 0.6);
  --accent: #ffb26b;      /* biome-tinted at runtime */
  --accent-soft: rgba(255, 178, 107, 0.25);
  --radius: 14px;
  --glass-bg-strong: rgba(14, 16, 30, 0.62);
  --scrim-rgb: 6, 6, 16;
  --menu-ink: #fff7ec;
  --menu-ink-dim: rgba(255, 247, 236, 0.78);
}
```

## 8. Responsive

One breakpoint, `@media (max-width: 640px)`, which tightens HUD padding and
reduces the corner groups so the road stays visible. The main menu restructures
at the same breakpoint: the left-anchored column becomes a full-width bottom
sheet with a vertical scrim, and the wordmark's letter-spacing tightens so
EVERROAD still fits one line at phone width. Everroad renders on small
screens; it is not driven on them — touch controls are out of scope, so the
mobile treatment optimizes for watching, not playing.
