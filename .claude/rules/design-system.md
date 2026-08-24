---
paths:
  - "src/ui/**/*.ts"
  - "src/ui/*.css"
  - "src/style.css"
  - "index.html"
---

# Design System Rules

Colors, radii, blur, and fonts come from the CSS custom properties defined in
`src/style.css` — `--glass-bg`, `--glass-border`, `--glass-blur`, `--accent`,
`--accent-soft`, `--radius`, `--font-ui`, `--font-mono`, and the text colors.
Token values and component specs live in docs/DESIGN_SYSTEM.md. The engine
retints `--accent` and `--accent-soft` per biome every time the biome changes,
so a hardcoded accent color silently stops following the world.

`#ui-root` is `pointer-events: none`; interactive surfaces opt back in with
`pointer-events: auto`. Anything that does not need clicks stays transparent to
them, because the world behind the overlay is the game.

Reuse the shared recipes rather than restyling: `.panel-glass` for panel
surfaces, `.hud` for the lighter corner variant, and the `.btn` / `.chip` /
`.pill` / `.key-hint` / `.progress-track` utilities.

Text meets WCAG AA contrast (4.5:1) against the glass surface, which is
translucent over a bright, changing world — check against a pale sky, not just
a dark one. Every panel is reachable and dismissible by keyboard, focus is
visible, and panel keys are ignored while a text field has focus. Transitions
run ~0.25 s ease and entrances are short scale+fade keyframes; all motion is
wrapped so `prefers-reduced-motion: reduce` drops it to an opacity change.

The HUD updates inside a rAF loop that re-reads live state each frame. Write to
the DOM only when the displayed string or class actually changed — the
change-detecting helpers in `src/ui/dom.ts` exist for this, and skipping them
puts layout thrash on the same frame budget as the renderer.
