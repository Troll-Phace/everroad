# EverRoad — Handcrafted Model Pipeline

Blender-authored replacements for individual procedural assets, baked into the
bundle at build time.

---

## 1. Policy

**Procedural is the default and stays the default.** Every new asset is built
by code in `src/world/` unless someone deliberately decides that one specific
asset is worth hand-modelling. There is no ambition to replace the procedural
system, and no asset is "waiting" for a model.

The opt-in is the existence of a recipe. `getProto` and `buildCar` look for a
handcrafted model, and fall through to their procedural builder when there
isn't one — which is the ordinary case, not a failure.

This preserves the decision that actually matters in
[ARCHITECTURE.md §15](ARCHITECTURE.md#fixed-decisions): **nothing is fetched at
runtime.** A handcrafted model is compiled into the JS bundle as quantised
vertex data. There is no loader, no `public/` directory, no network request,
and cold start is unchanged.

## 2. The pipeline

```
assets/models/src/car.compact.py      recipe — the source of truth (git)
        │  Blender + tools/blender/everroad_kit.py
        ▼
assets/models/car.compact.evr.json    intermediate — readable, committed (git)
        │  npm run models  (scripts/build-models.mjs)
        ▼
src/world/models/generated.ts         quantised base64, committed (git)
        │  src/world/models/codec.ts  (at boot)
        ▼
Proto  /  CarRig                      exactly what the procedural builder returns
```

Five properties fall out of that shape:

| Property | Because |
|---|---|
| Models are reviewable in a PR | the recipe is Python, not a binary |
| Any machine can rebuild every model | the recipe is the source; `.blend` is scratch |
| CI needs no Blender | the intermediate is committed and `models:check` verifies the last hop |
| The bundle guard already covers models | they are JS, measured by `npm run size` |
| A model can never half-load | it is a module, not a fetch |

`.blend` files are git-ignored. **If a model only exists in a `.blend`, it does
not exist.**

## 3. Coordinate frame

Recipes are written in **game space** — X right, Y up, **+Z forward**, metres,
base of the model at `y = 0` — so a recipe reads like the `car.ts` or
`scenery.ts` code it replaces. The kit converts to Blender's Z-up frame going
in and back on the way out:

```
game (x, y, z)  <->  blender (x, -z, y)
```

You never write a Blender-space number, and you never think about the swap.

## 4. Material slots

A part's colour is not baked into the model — it is a **slot** the runtime
fills, so one handcrafted body serves every car painted with it.

**Scenery** (`src/world/scenery.ts` semantics):

| Slot | Becomes |
|---|---|
| `tint` | `Proto.mask = 1` — the per-instance biome palette colour `chunks.ts` applies |
| `#rrggbb` | `Proto.mask = 0` with that baked colour |

**Car** (`src/world/carPalette.ts`):

| Slot | Becomes |
|---|---|
| `body` / `accent` | `CarStyle.bodyColor` / `CarStyle.accentColor` |
| `glass`, `tire`, `hub` | the fixed shared tones |
| `head`, `tail` | emissive light toon materials |
| `pad`, `glow` | rig-owned additive basics (hover bodies only) |
| `#rrggbb` | a literal toon colour |

In Blender these are materials named `EVR.<slot>`. The exporter splits a mesh
by material index, so one object can carry several slots.

## 5. Part roles (car profile)

| Role | Meaning |
|---|---|
| `static` | welded to the body |
| `wheel` | spins with ground speed; geometry stored relative to its axle pivot |
| `hub` | spins with the wheel sharing its `_fl` / `_fr` / `_rl` / `_rr` suffix |
| `hoverPad` | pulsing disc; hover bodies only |
| `glow` | additive underglow slab |

Scenery parts are always `static`.

Two runtime contracts are reproduced exactly by `models/carModel.ts`, and both
are load-bearing for `animateCar`:

- A wheel spins about its mesh's **local Y**, because the procedural tyre is a
  cylinder turned 90° about Z. Handcrafted wheel geometry is counter-rotated
  into that same frame, so net orientation is unchanged and the spin axis is
  the axle. The 90° tilt is applied with Euler order **`ZYX`** (`axleFrame` in
  `world/wheelFrame.ts`), which is the load-bearing half: with Three.js's
  default `XYZ`, `rotation.y` composes as a turn about the *parent's* vertical
  axis applied after the tilt, and the wheel yaws flat in the arch instead of
  rolling. Both the tyre and its hub need it.
- `wheelGroup.children` is `[tire, hub]`. A one-piece wheel gets an empty
  placeholder so the index stays valid.

## 6. The authoring loop

**Interactive** — Blender open, MCP connected. The recipe stays on disk and is
re-executed; the MCP is only the RPC channel, never the place the model lives.

```python
import sys, importlib
sys.path.insert(0, '/abs/path/to/IdleDrive/tools/blender')
import everroad_kit as evr, everroad_export
importlib.reload(everroad_export); importlib.reload(evr)
everroad_export.set_recipe('/abs/path/to/IdleDrive/assets/models/src/car.compact.py')
exec(open('/abs/path/to/IdleDrive/assets/models/src/car.compact.py').read())
```

Then `get_viewport_screenshot` for shape, and `npm run models` + the model
viewer for the verdict.

**Headless** — no MCP, reproducible, what a teammate or a rebuild runs:

```bash
npm run models:blender -- car.compact
```

Set `BLENDER=/path/to/blender` if it isn't in the default macOS location. Omit
the name to rebuild every recipe.

**Then, always:**

```bash
npm run models
```

## 7. The model viewer

```bash
npm run dev    # then open /model-viewer.html
```

Every subject is rendered twice — procedural on the left, handcrafted on the
right — under the game's own toon ramp, hemisphere/sun lighting and fog, at
chase-cam distance, with the wheels rolling. A model that reads well in
Blender's viewport routinely reads badly under a 3-step ramp, so this is where
the call gets made, not in Blender.

`?models=procedural` on the game itself disables handcrafted models wholesale,
for a like-for-like comparison in situ.

## 8. Budgets

Enforced by `scripts/lib/model-codec.mjs`; `warn` prints, `max` fails the
build.

| | warn | max |
|---|---:|---:|
| Scenery triangles | 500 | 1400 |
| Car triangles | 3000 | 6000 |
| Bytes per model | 40 kB | 150 kB |
| Bytes, all models | — | 120 kB |

Scenery is the tight one. `chunks.ts` CPU-bakes **every placement** into a
merged geometry, at 38–52 placements per 60 m chunk across ~28 live chunks, so
a proto's cost is multiplied by roughly 45 per chunk. For reference, the
procedural protos are:

| kind | tris | | kind | tris |
|---|---:|---|---|---:|
| oak / maple / cherryTree | 264 | | fence | 60 |
| poplar | 104 | | reeds | 48 |
| pine / windmill | 66 | | rock / hay / grassTuft | 40 |
| lavenderRow | 480 | | sunflowerPatch | 1232 |

A handcrafted tree should land near 264, not near 1400. Only one car is on
screen at a time, so the car budget is far looser — a full compact with bevels,
glass and hubbed wheels measures ~516 tris and ~4.8 kB.

The bundle guard in `npm run size` is the real backstop: models are JS.

## 9. Verification

| Layer | Command | Runs in CI |
|---|---|---|
| Exporter + kit | `npm run models:smoke` | no — needs Blender |
| Encoder ↔ decoder round trip | `npm run test:run` | yes |
| Validator + budgets + codegen freshness | `npm run models:check` | yes |
| Bundle size | `npm run size` | yes |

`npm run verify` runs everything except the Blender smoke test.

`models:check` fails when `generated.ts` disagrees with `assets/models/`, which
is what stops a stale generated module from shipping.

## 10. Poly Haven

Use it for HDRI lookdev and reference **only**. Do not ship its geometry or
textures: the assets are photoscan-realistic, 4k-textured and thousands of
triangles, which is the opposite of an untextured vertex-coloured toon look and
would blow the bundle on its own. The same goes for any other asset library.

## 11. Adding a model

1. `cp assets/models/src/_template.py assets/models/src/<profile>.<key>.py`
2. Author it — game space, base at `y = 0`, slots not colours.
3. `npm run models:blender -- <stem>` then `npm run models`
4. Check it in the viewer against the procedural original.
5. `npm run verify`
6. Commit the recipe, the `.evr.json`, and `generated.ts` together.

To back a model out, delete its `.evr.json` and re-run `npm run models` — the
asset returns to procedural with no other change.

## 12. Troubleshooting

| Symptom | Cause |
|---|---|
| `"<kind>" is not a SceneryKind` | the name in `evr.scenery()` must match the union in `biomes.ts` |
| `sits N m below y=0` | scenery bases at the origin; `chunks.ts` sinks it 0.12 m itself |
| `expected 0 or 4 wheel parts` | wheels must be named `*_fl`, `*_fr`, `*_rl`, `*_rr` |
| Wheel rolls sideways | the wheel's object origin is not on the axle |
| Wheel yaws / swivels flat in the arch | the mesh's Euler order is not `ZYX` — use `axleFrame` |
| Model is 90° out | authored in Blender space instead of through the kit |
| `generated.ts is out of date` | run `npm run models` and commit the result |
| Model looks flat/faceted | pass `smooth=True`; normals are derived, not exported |
