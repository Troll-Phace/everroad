# Self-hosted type

EverRoad ships its two faces in the bundle rather than fetching them from
Google Fonts. The desktop build launches over `file://` with no guarantee of a
network, and a remote webfont there means the wordmark, HUD and panels silently
reshape into whatever system sans/mono the machine happens to have. Shipping
the files also lets `electron/main.cjs` keep `style-src` / `font-src` at
`'self'` — the two `fonts.g*.com` hosts existed in that policy only to permit
the remote load (ARCHITECTURE.md §16.3).

| file | family | axis | bytes |
| --- | --- | --- | ---: |
| `quicksand-latin-var.woff2` | Quicksand | `wght` variable | 28,244 |
| `jetbrains-mono-latin-var.woff2` | JetBrains Mono | `wght` variable | 31,432 |

Both are the **latin** subset of the **variable** font, taken from the exact
`fonts.gstatic.com` URLs the old `<link>` in `index.html` resolved to. Variable
is what keeps this cheap: the CSS asks for Quicksand at 400/500/600/700 and
JetBrains Mono at 400/600, and one file per family serves every one of those —
six static instances would have cost roughly three times as much.

The latin subset is not a downgrade from what the game had. The UI's non-ASCII
copy is emoji (biome and weather icons) plus a handful of symbols — `★ ⚙ ⚠ → ▸`
— and no Google subset of either family contains those either, so they came
from the system fallback before this change and still do.

Weights are declared as ranges in `src/style.css`. Changing a `font-weight` in
the CSS to a value outside the declared range will clamp rather than fail
visibly, so widen the range there if the design ever reaches past it.

## Licensing

Both families are SIL Open Font License 1.1, which requires the licence text to
travel with the binaries — including into the packaged desktop app.

That is why the two `OFL.txt` files are **not** in this directory. Vite only
emits what the bundle imports, and a `.txt` nobody imports would never reach
`dist/`; electron-builder then packages `dist/**/*`, so the shipped app would
have carried the fonts without their licence. They live in `public/fonts/`
instead, which Vite copies verbatim, landing them at `dist/fonts/`:

    public/fonts/Quicksand-OFL.txt       →  dist/fonts/Quicksand-OFL.txt
    public/fonts/JetBrainsMono-OFL.txt   →  dist/fonts/JetBrainsMono-OFL.txt

The woff2 files stay here rather than joining them in `public/`, because the
`url()` in `src/style.css` has to be rewritten to a relative path — the build
sets `base: './'` so `dist/index.html` works over `file://`, and a root-absolute
`/fonts/…` from `public/` would resolve against the filesystem root in the
desktop app. Vite only performs that rewrite for assets it processes.

So the two halves are deliberately split, and moving either one breaks
something quiet. If these files ever relocate, move both and re-check that
`dist/` still contains the licences after `npm run build`.

The repo-level third-party notice lives in the root `LICENSE`.
