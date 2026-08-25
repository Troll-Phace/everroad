# Handoff — floating terrain in attract mode

**Status:** RESOLVED — hypothesis A confirmed (offline pair-walk + live repro) and fixed
by the terrain perimeter skirt on branch fix/floating-terrain-ribbon-skirt (issue #88).
The ribbon's open cut edges — lateral ±165 m and the s-ends — were the floating band;
they are now closed by a bevelled, depth-shaded wall dropping `TER_SKIRT_DROP` below
the surface (src/world/chunks.ts, ARCHITECTURE.md §5.3). §3 (instrumentation) and §6
(verification rules) remain worth reading for any future work in this area.
**Build:** confirmed present on `fcb4e5d` (PR #87, merged 2026-08-25). Confirmed by the
reporter after a hard reload, on the build badge reading `fcb4e5d`.
**Written by:** the session that shipped PR #87, immediately after it failed to fix this.

Read this before touching `src/world/farLand.ts`. The short version: PR #87 fixed two
real defects and did not fix the one the player keeps reporting, and the reason it
shipped anyway is a verification failure I made three times in one session. Section 6
is the most important part of this document.

---

## 1. The symptom

In attract mode (the title-screen footage), a **band of terrain hangs above the
horizon**, detached from the ground, with pale sky or haze visible beneath it. The
reporter's words: "terrain funkiness in the attract view with things unloading or
floating in the air behind or far enough around the radius of the car."

From two screenshots supplied by the reporter (autumn biome, dusk, low camera near
the car — a `lowChase`/`heroLowFront`-class vantage):

- The floating band spans the **full frame width**.
- It has a **hard, straight lower edge**. Straight enough to read as a mesh boundary
  rather than as a landform.
- In one shot the band is **tilted** relative to the horizon.
- It carries **road surface, trees, fences and flowers** — it is the terrain ribbon
  with its scenery, not the backdrop fan (the fan has no props on it).
- Its **colour differs from the near ground**: a green band over an autumn-tan
  foreground in one shot, a tan/brown band over orange in the other. Different colour
  means a different point along `s` — a different biome blend.
- It is **not heavily hazed**. At the shipped densities anything at the ribbon's
  forward cut (1320 m) is 96–99% hazed, so a band that still shows saturated tree
  colour is much nearer than that — order a few hundred metres.

Those last three points are the strongest evidence available and should drive the
next investigation. See §5 hypothesis A.

## 2. What PR #87 changed, and what it did fix

Two independent defects, both real, both measured:

1. **The far-land backdrop was a flat saturated slab.** `FAR_LAND_HAZE_SCALE = 4.5`
   put the nearest visible ring at 1327 m of implied depth, so no part of the
   backdrop ever showed its own colour. It now stands on the ground under the camera,
   carries a height field, and fogs at honest depth. The constant, its ramp, the
   `aHaze` attribute and the shader injection are deleted.
2. **Ground cover was banded around the car, not the camera.** `roadsideStatic`
   stands up to `MENU_MAX_LEAD` = 260 m ahead; ten of twelve catalog cars put the eye
   outside its own cover. Now a `CoverEye`/`coverBand` union, with the cover pass
   split out of `ChunkManager.update` so it runs after the camera block.

Both landed. The reporter confirms **the culling half is better**. The backdrop half
measurably improved the flat-slab problem (numbers in §4) but did **not** resolve the
floating terrain.

Do not revert #87 to chase this. The two defects it fixed were independently
confirmed and the constants it deleted were derived from a case that does not
occur (see the commit message on `fcb4e5d`).

## 3. Instrumentation that works

All of this runs in the Browser pane against `npm run dev` on port 5199. There is a
dev-only handle at `window.__everroad` exposing `scene`, `camera`, `menuCam`,
`daynight`, `weather`, `chunks`, `grass`, `renderer`, `path`, `vehicle`, `state`,
`enterMenu`, `startGame`, `quitToMenu` (`src/main.ts`, guarded by `import.meta.env.DEV`).

**Gotchas that cost me time — read these first:**

- The Browser pane's `javascript_tool` **collapses newlines**. Send JS on one line and
  use **no `//` comments**, or the rest of the statement is swallowed and you get a
  bare `SyntaxError`.
- `requestAnimationFrame` in the pane is **throttled to ~3 fps** unless the tab is
  fronted, and often even then. Anything needing real frame rates must be driven
  synchronously in-page, not sampled across frames.
- `resize_window` and the actual capture size **drift out of sync**. The page reported
  1000×590 while the capture showed the canvas at 346×207, and at one point the
  viewport went portrait (800×1546) without my noticing. **Check
  `renderer.getContext().drawingBufferWidth/Height` and the aspect ratio before
  trusting any screenshot.** The reporter's window is 2000×1182 (landscape, ~1.69).
  Several of my sweeps ran at aspect ratios the player never sees.
- `screenshot` captures can be stale. Cross-check against a framebuffer read.

**Reading pixels** (authoritative, unlike screenshots):

```js
// one line in practice, no comments
const grab = () => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(() => {
  const gl = __everroad.renderer.getContext();
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  const buf = new Uint8Array(w * h * 4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  res({ w, h, buf });
})));
```

GL row 0 is the **bottom** of the screen. Getting this backwards silently inverts
every conclusion.

**Isolating a layer by tinting it.** This is the single most valuable technique in
this investigation — it turned "the distance looks milky" into "the backdrop is 6–23%
of the frame and there is no distant landscape on screen at all" in one step.

```js
const fl = __everroad.scene.getObjectByName('farLand');
fl.__orig = fl.material;
fl.__mag = new (fl.material.constructor)({ color: 0xff00ff, fog: false, side: 2, depthWrite: false });
fl.material = fl.__mag;   // magenta = backdrop
```

**Tinting the sky dome** is harder and the obvious approach fails silently. The dome
is a raw `ShaderMaterial` at `renderOrder -10` with uniforms
`uZenith / uHorizon / uGlowColor / uGlowStrength / uSunDir / uNight / uAurora / uTime`.
`sky.update` **mutates the Color in place**, so assigning `uniforms.uZenith.value`
once is overwritten on the next frame, and defining a getter that returns a single
shared Color gets that Color mutated instead. Return a **fresh** Color per read:

```js
Object.defineProperty(u.uZenith, 'value', { get() { return new C(0, 1, 1); }, set() {}, configurable: true });
```

Lock `uHorizon` the same way and pin `uGlowStrength`, `uNight`, `uAurora` to 0.
Verify by screenshot that the sky is actually cyan before trusting any classifier
built on it. I shipped a conclusion off an unverified version of this.

**Forcing a specific shot.** `MenuCamera.rand` is an injectable `() => number`
(constructor param, `src/world/menuCamera.ts`). Feed it a scripted sequence — the
first draw picks the shot index, then duration, then `side`, then `roll`:

```js
const seq = [(i + 0.5) / 8, 0.5, side < 0 ? 0.2 : 0.8, roll];
let k = 0;
menuCam.reset();
menuCam.rand = () => seq[Math.min(k++, seq.length - 1)];
menuCam.update(vehicle, 0);
menuCam.rand = Math.random;
menuCam.duration = 9999;   // hold the take
```

**Freezing a frame:** patch `menuCam.update` and `vehicle.update` to no-ops. **Freezing
time:** patch `daynight.update` to call the original with `dt = 0`, then drive
`daynight.setTimeOfDay`. **Forcing weather:** set `weather.current`, `weather.previous`,
`weather.fade = 1`, `weather.episodeLeft = 99999`. **Forcing a biome:** call
`enterMenu()` in a loop until `runtime.biomeId` matches — it re-rolls car, biome, hour
and weather each call.

**Note:** `runtime.*` and `scene.fog.*` are written by the frame loop, so anything you
set takes effect on the *next* frame. Read them back after a `setTimeout`, not
synchronously — I misread a fog density by 10× this way.

## 4. What was measured, and the one number that matters

Matched protocol, both builds, same detector, 20 samples each, forced to autumn
across five shots and four times of day around dusk. Sky dome cyan, backdrop magenta,
so "land with sky under it" and "land with backdrop under it" are distinguishable
rather than guessed:

| build | columns showing **sky** under a floating band | columns showing **backdrop** under it |
|---|---|---|
| `68929d3` (pre-#87) | 316 | 179 |
| `fcb4e5d` (post-#87) | 23 | 150 |

Worst single frame: 80 sky-gap columns before, 4 after. The 23 residual columns were
checked and are at **14–27° elevation** — sky between nearby pine trunks at close
range, which is correct behaviour, not a backdrop failure.

Backdrop colour behaviour, meadow/day/clear at density 0.0014, sampling a screen
column and comparing against the same column with the backdrop hidden:

| | before | after |
|---|---|---|
| backdrop's own colour range down its height | 8 levels of blue | 87 / 18 / 55 (three columns) |
| step against the sky at its crest | +30 blue | −5 / −1 / −1 |

**None of this measured the reported defect.** That is the point of §6.

## 5. Hypotheses, ranked

**A. The ribbon's far lobe seen across a gap where the road doubles back.** Best fit
to the evidence. `RoadPath.curvature` is a sum of four sines with |k| ≤ 1/87.7 m, so
the road loops hard enough to come back near itself. The terrain ribbon is swept in
path space and simply **ends at ±165 m** (`TER_COLS`), so two lobes of road a few
hundred metres apart leave a **wedge of nothing** between them. Across that wedge you
would see: near lobe (foreground) → backdrop in the gap → **far lobe, at a different
`s`, hence a different biome colour, and near enough to be barely hazed** → sky. That
reproduces every listed property in §1 including the straight edge (the ribbon's
lateral cut), the tilt, the colour mismatch, and the lack of haze.

I saw this directly from a 200 m aerial camera early in the investigation: the ribbon
is a winding strip with pale wedges of backdrop between its lobes, and a second road
visible across the gap. I did not connect it to the reported symptom at the time.

*Next experiment:* put the camera at a menu-legal height (0.65–27 m) at a road
position where two lobes are close, and look across the gap. Find candidate `s` by
walking `RoadPath` and looking for pairs `(s1, s2)` with `|s1 - s2| > 800` but
euclidean distance between `path.point(s1, 0)` and `path.point(s2, 0)` under ~600 m.
That is a pure offline computation — no renderer needed — and it should be a test.

**B. The backdrop is covering the gap but at the wrong haze, so the far lobe reads as
detached.** Related to A rather than exclusive of it. The backdrop now fogs at honest
geometric depth. If the far lobe is 300 m away and the backdrop pixel behind it is
also ~300 m, they match — but the *gap between them* is at whatever depth the fan
surface sits, which may be much further. Worth measuring the actual haze on both
sides of the seam rather than assuming.

**C. Elevation: the far lobe is genuinely higher ground.** `landHeight` gives the
ribbon a far-field rise toward its lateral edges, so a lobe seen side-on presents a
raised bank. Combined with A this would lift the band well above the horizon.

**D. Something I have not thought of.** Given the record in §6, weight this heavily.

Explicitly **ruled out**: the anchor snap (fixed, snaps on vantage not ground height,
`FAR_LAND_CUT_DISTANCE`); ground cover banding (fixed and confirmed by the reporter);
a stale build (the reporter checked the badge).

## 6. How this shipped broken — read this before you verify anything

I built four instruments in this session. **Three of them were wrong, and each one
produced a confident, plausible, false number.**

1. A "floating land" detector that classified sky as blue-dominant. At sunset the sky
   is pink, so it classified the entire sky as terrain and returned zero hits. I ran
   26 samples against it and reported a null result before checking it.
2. A contrast measurement that sampled across each element's full bounding box. The
   wordmark's box is 540 px wide against 369 px of ink, so most samples landed where
   no glyph exists and it reported an AA failure at 2.55. Confined to the text's own
   client rects it is 5.58. I nearly filed a bogus accessibility issue.
3. A gap classifier run without the sky marker installed, so the sky counted as the
   land band and it reported 90% of columns defective. The screenshot showed a
   perfectly normal frame.

And the one that actually mattered:

4. A metric that **only counted sky as a failure**, on the assumption that "land with
   backdrop beneath it" was correct behaviour. I never checked that assumption
   against a picture. There were 150 such columns on the shipped build. If hypothesis
   A is right, some of those *are* the defect, and the metric I used to declare
   victory was structurally incapable of seeing it.

This is the same failure the previous work item recorded (`.claude/state/progress.md`,
lesson 5: an attract-mode test whose counter short-circuited before the occlusion
check, which passed at a value its own docblock rejected). **That is three items in a
row where a confident number in this area measured the wrong thing.**

The rule this earns: **for a visual defect, a metric is not evidence until a
screenshot of a frame it flags — and a frame it clears — has been looked at.** Tint
the layer, screenshot it, confirm the tint took, and only then count pixels. Every
correct conclusion in this session came from the tint-and-look step; every wrong one
came from counting first.

Corollary: check the viewport aspect before every sweep. Several of mine ran portrait
or at a fraction of the intended size without my noticing.

## 7. Where the code is

| what | where |
|---|---|
| Backdrop geometry, profile, anchor, haze | `src/world/farLand.ts` |
| Backdrop tests, ray-march + monotonicity sweeps | `src/world/farLand.test.ts` |
| Terrain ribbon, `TER_COLS` (±165 m), chunk lifecycle, cover band | `src/world/chunks.ts` |
| Road curve, `curvature`, `foldSafeLateral` | `src/world/roadPath.ts` |
| Attract-mode shot list, `MENU_MAX_LEAD`, `MENU_SAFE_DISTANCE` | `src/world/menuCamera.ts` |
| Fog colour and density, frame loop ordering, debug handle | `src/main.ts` |
| Narrative reference | `docs/ARCHITECTURE.md` §5.3 (ribbon + backdrop), §5.7 (cover), §5.8 (fog) |

Key constants in `farLand.ts`: `FAR_LAND_INNER_RADIUS` 20, `FAR_LAND_RIM_DROP` 5,
`FAR_LAND_RIDGE_HEIGHT` 650, `FAR_LAND_RANGE_SINK` 90, `FAR_LAND_SPUR_HEIGHT` 240,
`FAR_LAND_GAP_ANGLE_DEG` 7.6, `FAR_LAND_MAX_EYE` 60, `FAR_LAND_CUT_DISTANCE` 8.

The frame loop's ordering is load-bearing in two directions and both call sites say
so: `chunks.update` must precede the camera block (the director samples terrain the
chunks own), `chunks.updateCover` must follow it (cover is banded around where the
camera ended up).

## 8. Related open issues

- **#83** — night horizon band edge: the sky dome is a raw `ShaderMaterial` that skips
  ACES tone mapping while the fogged backdrop does not, so no fog colour can close the
  gap. Separate defect, same seam.
- **#72** — distant scenery keeps its contrast after the ground it stands on has fogged
  out. **Possibly the same underlying defect as this handoff**, seen from the other
  side. Worth reading before starting.
- **#84** — no test bounds the forward case the deleted haze constant was derived from.
- **#85**, **#86** — far-land test debt.
- **#38** — distant tree trunks alias out, leaving canopies visually detached.
