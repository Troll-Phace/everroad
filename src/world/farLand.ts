import * as THREE from 'three';
import { blendColor, type BiomeVisual } from './biomes';
import { terrainMeshHeight } from './chunks';
import { noise2, toonRamp } from './materials';
import type { RoadPath } from './roadPath';

/**
 * The land beyond the terrain ribbon.
 *
 * The ribbon (`chunks.ts`, §5.3) is swept along the road curve and stops at
 * `TER_COLS` ±165 m, so a near-horizontal sight line runs out over the fields,
 * leaves the ribbon a metre or two above the surface and finds nothing to hit.
 * Rendering the live scene's own chunk meshes to an off-screen mask and
 * counting sky pixels that have terrain above them in the same column, that is
 * 5 to 1620 px at the sunflower-coast repro (s = 6750) with this backdrop
 * hidden, depending on the vantage, and up to a million at the road's tightest
 * bends — sky sitting between the land silhouette and the canopies just above
 * it, the "floating distant trees" report. With the backdrop the count is 0, at
 * that repro and at all three tight bends, from every one of six vantages
 * spanning 0.65 m to 27 m of eye height and 26° to 62° of lens.
 *
 * Widening the ribbon cannot fix it: the road's minimum radius of curvature is
 * the analytic 87.7 m (`1 / (0.0042 + 0.0035 + 0.0028 + 0.0009)`, the sum of
 * `RoadPath.curvature`'s four sine amplitudes), so a path-space sweep past
 * ±165 m folds over itself. This backdrop is therefore built in **world
 * space**, a radial fan that translates (never rotates) with the camera the way
 * `Sky`'s dome does. Nothing about it follows the road curve, so nothing folds.
 *
 * ## What it is anchored to, and why that is the whole design
 *
 * The fan hangs off the **ground under the camera**, not off the eye, and its
 * profile is a height field in metres above that ground rather than a set of
 * elevation angles from the lens. `update` samples `terrainMeshHeight` at the
 * camera's own road coordinates and puts the mesh there.
 *
 * That is not a refactor of the old eye-anchored version; it is the fix for the
 * defect this module shipped with. Anchoring the profile to the eye meant the
 * inner rings sat 15-20 m *below* ground level — a bowl — so the surface had to
 * climb back out of its own hole before it could show, and it broke the horizon
 * at a radius that had nothing to do with how far away that piece of land was
 * meant to be. A horizon-grazing ray met the fan at 295-380 m no matter what
 * the world beyond the ribbon looked like, which is why the backdrop needed a
 * fudge factor (`FAR_LAND_HAZE_SCALE`) to fog as though it were four and a half
 * times further away than it was. Grounded, the geometry is at its true
 * distance, and the fog is simply the scene's own `FogExp2` doing its job.
 *
 * ## The profile
 *
 * Per azimuth the surface is the upper envelope of three simple pieces:
 *
 * - a **rim plane** a few metres under the anchor, which is what the nearest
 *   rings sit on. Under rather than level with it for two reasons: sampling
 *   error must never lift the rim above real terrain, and the rim has to hang
 *   steeply enough that a ray passing beneath it meets the ribbon before it
 *   reaches the sky (`FAR_LAND_INNER_RADIUS`);
 * - a **spur**: a low cone standing for the nearer hills, 240-400 m tall at the
 *   outer radius;
 * - a **range**: the tall cone that carries the silhouette, `FAR_LAND_RIDGE_HEIGHT`
 *   plus its wander at the outer radius.
 *
 * Each cone is written as `A·(r/R) - b·(1 - r/R)`: it reaches `A` at the outer
 * radius and is sunk `b` metres at the eye's own position, so `b` is exactly
 * the knob that decides **how far out that piece of land climbs into view**.
 * Both `A` and `b` are noise functions of azimuth, which is where the relief
 * comes from: the land breaks a 1.6 m eye's horizon at 260 m in some directions
 * and 741 m in others, and the spur crosses under the range at a radius that
 * wanders between 265 m and 1206 m, leaving a crease — a crest line that runs
 * *around* the eye the way a real ridge does rather than radiating out from it.
 *
 * That azimuth spread is what the haze turns into layers, and it is the whole
 * of the relief the eye actually reads. Elevation is monotonic in radius (see
 * below), so a nearer crest can never occlude a further one; what varies is
 * *which distance* sits at a given elevation, and therefore how much of its own
 * colour it has left. Two degrees above the eye the surface is 391 m out in the
 * clearest direction and 951 m in the haziest — 74% of the land colour against
 * 17% — and at six degrees, 940 m against 1652 m.
 *
 * Two properties are worth stating because they are what makes the shape safe:
 *
 * - **Elevation is monotonic in radius from every eye height.** `A·(r/R) -
 *   b·(1-r/R)` divided by `r` is `(A + b)/R - (b + eye)/r`, which increases in
 *   `r` for any `b >= 0` and any eye at or above the anchor; a constant plane
 *   at `-FAR_LAND_RIM_DROP` gives `-(FAR_LAND_RIM_DROP + eye)/r`, which also
 *   increases; and the upper envelope of functions whose elevation increases
 *   has an elevation that increases. So the surface never overlaps itself, at
 *   any eye height, by construction rather than by tuning.
 * - **The silhouette clears every sky gap from every eye a shot can take.** The
 *   fan is continuous from the rim to the ridge, so it covers every elevation
 *   between them; the rim is below the horizon and the ridge is above
 *   `FAR_LAND_GAP_ANGLE_DEG` for any eye up to `FAR_LAND_MAX_EYE`. See those
 *   two constants for the derivation — the ridge height is the thing that has
 *   to hold at 0.65 m (`heroLowFront`) and at 27 m (`craneReveal`) alike, and a
 *   guarantee that holds at one eye height and fails at another is not one.
 *
 * ## Haze
 *
 * There is no haze constant here any more, and there should not be one. The
 * fan fogs on the distance it actually occupies, because that distance is now
 * honest: whatever climbs above the ribbon's edge is a few hundred metres to a
 * kilometre and a half out, and fogs as land at that distance does. It is not
 * honest in every direction at once — see `FAR_LAND_RANGE_SINK` for the one
 * case that cannot be, and what the azimuth spread does about it. Past about
 * 1.8 km `FogExp2` at
 * `FOG_BASE_DENSITY` has taken everything anyway (2.8% of contrast survives at
 * 1500 m, 0.2% at 2000 m), so scaling the outer rings' fog depth buys nothing
 * that saturation has not already bought — which is why the old
 * `FAR_LAND_HAZE_SCALE` could only ever spend its effect on the *near* rings,
 * flattening the one band that had colour left to lose. Measured at the
 * defaults it left the whole visible fan between 96% and 100% hazed: eight
 * levels of blue from the bottom of the band to the top, a slab. On the
 * grounded profile the same columns run 82 to 113 levels, and the foot of the
 * band keeps up to 74% of its land colour.
 *
 * That the fog is the scene's own also keeps the biome `mist` multiplier, the
 * weather `fogMultiplier` and `nightness` working on the backdrop exactly as
 * they work on the ribbon, for free and with no shader injection.
 *
 * The other half of the milk was the fog *colour*, and that lives in `main.ts`
 * (`FOG_SKY_RISE`, `FOG_AERIAL_MIX`): the top of this band saturates to it, so
 * it has to converge on the sky the band is seen against — which is the dome a
 * little way up, not the horizon — or the fan keeps a hard edge against the sky
 * no matter what its geometry does.
 *
 * ## Ordering
 *
 * It never writes depth and is drawn before every world mesh, so terrain and
 * scenery always paint over it and there is no depth to fight at the join. It
 * is not true that it occludes nothing: it deliberately covers the sky dome,
 * and it is ordered ahead of the sun and moon precisely so it does *not* cover
 * those — see `renderOrder` in the constructor.
 *
 * A caution that survives from the fold-fix work: at the road's tightest bends
 * the compressed ribbon stops nearer than it does elsewhere, and scenery
 * standing on it can still leave sky under a canopy that no horizon can close.
 * Measure with the scenery meshes hidden to see this module's own behaviour
 * separately from that.
 */

/**
 * Innermost radius, metres.
 *
 * Two things bound it, and the second is the one that bites.
 *
 * It must sit inside the ribbon in every direction, and the binding case there
 * is not the nominal ±165 m — it is the ribbon on the *inside* of the tightest
 * bend, where `foldSafeLateral` compresses the far columns onto an asymptote at
 * `FOLD_LIMIT` (0.85) of the local radius. At the analytic minimum radius of
 * 87.7 m that is 74.5 m of ground, so anything further out than that can be
 * left uncovered at some bend somewhere.
 *
 * And it sets how *steeply* the rim hangs, which is what closes the world
 * underneath the fan. With `FAR_LAND_RIM_DROP` it fixes the shallowest ray that
 * can pass under the rim: `(drop + eye) / this` metres of fall per metre out.
 * Anything steeper has to meet real terrain inside the ribbon or it escapes to
 * the sky, and the terrain is not obliging — it falls away from the road fast
 * enough to outrun a shallow ray for a long way. Marched against
 * `terrainHeight` over 6450 rays (40 km of road, five lateral stands, five eye
 * heights, both directions), the escape rate is 14% at 70 m over a 2 m drop,
 * one ray at 20 m over 2.5 m, and zero at or past 20 m over 3 m. This pair is
 * 20 m and 5 m — a slope of 0.283, about 1.8x the last value that failed.
 *
 * The symptom of getting it wrong is specific and worth recognising: a thin
 * band of sky a couple of rows deep, running the *whole width* of the frame at
 * exactly the rim's own elevation. 13,692 px of it at s = 431.6 km (R 88.7 m)
 * from a 0.65 m eye, at 70 m over a 2 m drop.
 */
export const FAR_LAND_INNER_RADIUS = 20;

/**
 * Outermost radius, metres. Inside the sky dome (6000) and the camera's far
 * plane (9000); far enough that the ridge is fully fogged several times over.
 */
export const FAR_LAND_OUTER_RADIUS = 4000;

/**
 * How far below the sampled ground the fan's rim sits, metres.
 *
 * Two jobs. The small one is tolerance: error in the ground sample — a damped
 * anchor lagging a climb, a terrain triangle sampled between its vertices —
 * must never lift the rim above the real surface and show a plate hovering over
 * the fields. A metre or two would cover that.
 *
 * The load-bearing one is the escape-ray bound in `FAR_LAND_INNER_RADIUS`,
 * which is what asks for five. It costs nothing on screen: at 20 m the rim is
 * under the road itself, and the plane it sits on stays under the ribbon well
 * past the hand-over at 165 m.
 */
export const FAR_LAND_RIM_DROP = 5;

/**
 * Height of the range at the outer radius, metres — the **floor** of the
 * silhouette, before its wander.
 *
 * This is the number that has to hold the sky-gap guarantee, and it has to hold
 * it from every eye a shot can take. At radius `R` an eye `e` above the anchor
 * sees the ridge at `atan((H - e) / R)`, so clearing `FAR_LAND_GAP_ANGLE_DEG`
 * needs `H >= e + R * tan(7.6°)` = `e + 533.6`. At 650 m that covers every eye
 * up to 116 m above the ground beneath it — far past the `FAR_LAND_MAX_EYE`
 * the menu director can produce, and the headroom is free: the ridge is 100%
 * fogged at any density the game asks for, so it costs pixels of sky that are
 * fog-coloured either way.
 *
 * Note what changed from the angle-based version this replaces. A ridge fixed
 * at 7.6° *from the eye* is a different promise at every eye height, and it was
 * derived at one of them. Fixing a height instead makes the weakest case the
 * highest eye, which is a case that can be stated and tested.
 */
export const FAR_LAND_RIDGE_HEIGHT = 650;

/**
 * How far the range's crest wanders **above** `FAR_LAND_RIDGE_HEIGHT`, metres.
 *
 * One-sided, as the angle-based wander was and for the same reason: the noise
 * is folded to 0..1 rather than -1..1, so the silhouette occupies
 * [floor, floor + this] and is never below the floor at any azimuth. Do not
 * "clean this up" into a symmetric ±wander — that drops the crest below the
 * floor on part of the circle, and whether a sky gap survives then depends on
 * which azimuth the dip happens to land on. Closure by luck rather than by
 * construction, and a horizon that is whole except on the outside of one bend
 * reads as unfixed and is far harder to diagnose the second time.
 *
 * 120 m at 4 km is 1.7° of wander over a 9.2° ridge, which is what keeps the
 * top edge from projecting to the dead-straight line that reads as a lid.
 */
export const FAR_LAND_RIDGE_RELIEF = 120;

/**
 * How far the range is sunk below the anchor at the eye's own position,
 * metres — minimum, and the span the azimuth noise adds on top.
 *
 * This is the knee: the cone crosses ground level at `R * b / (A + b)`, so
 * b = 90 puts it at 486 m and b = 200 at 949 m. It is the single number that
 * decides how much land colour survives in the band, because it decides how
 * near the land at the bottom of the band is: at 486 m `FogExp2` at the base
 * density has taken 38% of the contrast, at 950 m it has taken 74%, and past
 * 1.8 km it has taken all of it.
 *
 * Wanting it as near as possible is not the whole story, which is why the span
 * is wide rather than the minimum being lower. A backdrop that climbs into view
 * very near the eye is crisper than the ribbon's *forward* cut 1320 m away, and
 * a crisp band sitting on a pale strip of terrain is the failure the old haze
 * scale existed to prevent. Spreading the knee across azimuth means some
 * directions carry colour and others carry haze, which is both what a landscape
 * does and what keeps the near case rare enough to stay honest — the rolling
 * height field almost always puts a crest nearer than the cut anyway, and a
 * crest at 400 m is *nearer* than the fan above it in every one of these
 * directions.
 */
export const FAR_LAND_RANGE_SINK = 90;
/** Span the azimuth noise adds to `FAR_LAND_RANGE_SINK`. See it. */
export const FAR_LAND_RANGE_SINK_RELIEF = 110;

/**
 * Height of the spur — the nearer, lower cone — at the outer radius, metres,
 * and the span the azimuth noise adds.
 *
 * Well under `FAR_LAND_RIDGE_HEIGHT`, so the range always wins the silhouette
 * and the spur always ends up crossing under it somewhere. That crossing is the
 * point of the spur: it is a crease in the surface at 0.9-1.7 km, wandering
 * with azimuth, which is a crest line rather than a shading gradient. Below it
 * the visible land is the spur's, which climbs into view nearer than the range
 * does and so carries more colour.
 */
export const FAR_LAND_SPUR_HEIGHT = 240;
/** Span the azimuth noise adds to `FAR_LAND_SPUR_HEIGHT`. See it. */
export const FAR_LAND_SPUR_RELIEF = 160;

/**
 * How far the spur is sunk at the eye, metres, and the span the noise adds.
 *
 * Smaller than `FAR_LAND_RANGE_SINK` so the spur is the nearer of the two: it
 * crosses ground level at `R * b / (A + b)`, which is 235-903 m across the two
 * fields' extremes against the range's 419-941 m, and the pair that a given
 * azimuth actually draws puts the visible edge at 260-741 m.
 */
export const FAR_LAND_SPUR_SINK = 25;
/** Span the azimuth noise adds to `FAR_LAND_SPUR_SINK`. See it. */
export const FAR_LAND_SPUR_SINK_RELIEF = 45;

/**
 * Radii walked through `noise2` around the azimuth circle, one per field.
 *
 * Sampling the noise at `(cos az, sin az)` scaled makes it exactly periodic, so
 * the fan has no seam; the scale sets how many undulations fit around the
 * horizon, roughly `0.85 * scale` of them, so a 62° lens sees about a sixth of
 * that. The four fields are given different radii (and one an offset) so they
 * walk different circles of the same noise and do not move together: the
 * silhouette ripples fastest, the range's knee slowest — broad sweeps of near
 * and far land rather than a picket fence.
 */
export const FAR_LAND_RIDGE_NOISE_SCALE = 24;
/** Azimuth-circle radius for the range's knee. See `FAR_LAND_RIDGE_NOISE_SCALE`. */
export const FAR_LAND_SINK_NOISE_SCALE = 11;
/** Azimuth-circle radius for the spur's height. See `FAR_LAND_RIDGE_NOISE_SCALE`. */
export const FAR_LAND_SPUR_NOISE_SCALE = 17;
/** Azimuth-circle radius for the spur's knee. See `FAR_LAND_RIDGE_NOISE_SCALE`. */
export const FAR_LAND_SPUR_SINK_NOISE_SCALE = 31;

/**
 * Elevation, in degrees above the eye, that the silhouette has to clear.
 *
 * The fan closes every sky gap below its silhouette and none above it, so this
 * is the height of the highest gap the ribbon's own cut can leave. Measured
 * against the live scene by rendering the chunk meshes to a mask and reading
 * the elevation of the topmost terrain pixel per column: on unfolded road the
 * ribbon's edge silhouette tops out at 6.63° (s = 99.1 km, R 91.3 m, eye
 * 1.6 m), and gaps live under it. The old angle-based ridge floor was set at
 * 7.6° against the same measurement, and this keeps that number so the two are
 * comparable — `FAR_LAND_RIDGE_HEIGHT` then clears it from every eye height
 * rather than from the one it was measured at.
 */
export const FAR_LAND_GAP_ANGLE_DEG = 7.6;

/**
 * Highest the eye is ever expected to sit above the ground beneath it, metres.
 *
 * `craneReveal` lifts to 27 m over the *road surface* at its own (s, lat); the
 * terrain there can sit up to ~14 m below the road out in the fields, and
 * `MenuCamera`'s clearance lift can raise the eye further to clear a rise
 * between it and the car. 60 m covers that with room; the ridge as built holds
 * the guarantee to 116 m (see `FAR_LAND_RIDGE_HEIGHT`), so the margin here is
 * not load-bearing — it is the number the test sweeps to.
 */
export const FAR_LAND_MAX_EYE = 60;

/**
 * How far the surface normals are pulled back toward straight up, 0..1.
 *
 * The toon ramp is four flat stops, so a normal that tilts far enough to cross
 * a stop boundary paints a hard line. On the creases that is exactly what is
 * wanted — a crest reads as a crest. Across the open slopes it is not, so the
 * normals are leaned back toward vertical, which keeps the shading inside one
 * or two stops and lets the haze gradient carry the depth.
 */
export const FAR_LAND_NORMAL_SOFTEN = 0.55;

/** Vertex-colour swing across the fan, as a fraction of the biome ground tone. */
export const FAR_LAND_TINT_RELIEF = 0.07;

/** Radial rings. */
export const FAR_LAND_RINGS = 24;

/** Azimuth divisions. Keeps the ridge and the creases smooth at frame edges. */
export const FAR_LAND_SEGMENTS = 128;

/**
 * Metres the **vantage** must move in one frame for the anchor to snap rather
 * than damp, in road coordinates.
 *
 * The anchor follows the terrain under the camera, and a raw per-frame sample
 * jitters: the drawn surface is flat triangles, and a menu eye crossing them at
 * speed steps between facets. At 800 m — the near edge of the visible band — a
 * metre of anchor moves the horizon about a pixel, so the jitter is visible and
 * the anchor is damped. What damping must not do is slide the whole horizon
 * across the frame after a cut, which at `FAR_LAND_ANCHOR_DAMP` takes ~0.8 s to
 * settle and is the only motion on screen during `roadsideStatic`, the one shot
 * whose rig deliberately does not move.
 *
 * The quantity here is the vantage, not the ground height, and that distinction
 * is the whole of it: a cut is a discontinuity in **where the camera is**, and
 * the ground it lands on may happen to be at a similar height. Thresholding the
 * height instead damped 59% of `roadsideStatic` cuts — median 6.38 m of anchor
 * move, which tilts the crest at 400 m by 0.92°, some 30 px of horizon drift
 * down that shot's 26° lens.
 *
 * 8 m is derived from the two distributions, measured over 401 cuts on the
 * shipping seed at car speeds from 18 to 55 m/s:
 *
 * - within a shot the vantage never moves more than **1.11 m** in a frame, and
 *   the ground under it never more than 0.06 m — the shots' own eye moves are
 *   slow and continuous next to a cut;
 * - every cut that moves the ground more than 2 m jumps the vantage by at least
 *   **14.7 m**, and at this threshold the 18 cuts in 401 that still damp move
 *   the ground by at most **0.34 m** — 0.05° at 400 m, under two pixels.
 *
 * Round *down* if it ever needs revisiting, because the two errors are not
 * symmetric. A missed cut slides the horizon for most of a second. A false
 * positive — a hitching frame at the `dt` clamp of 0.1 s and top speed puts a
 * shot's own motion near 6.6 m — snaps the anchor across at most a few tenths
 * of a metre of ground, on a frame that is already dropping.
 *
 * Inferring the cut rather than being told about it is deliberate.
 * `MenuCamera` has a `fresh` flag and could hand it over, but it is consumed
 * inside its own `update`, it says nothing about the play rig, and it says
 * nothing about a world re-seed. The measured separation above is wide enough
 * that the inference costs nothing and covers all three. `reanchor` is there
 * for the case inference genuinely cannot see — see it.
 */
export const FAR_LAND_CUT_DISTANCE = 8;

/** Damping rate for the anchor, per second. See `FAR_LAND_CUT_DISTANCE`. */
export const FAR_LAND_ANCHOR_DAMP = 6;

const GROUND = (b: BiomeVisual): string => b.ground;

/** Radius of ring parameter `t` (0 = inner rim, 1 = outer ring), metres. */
export function farLandRadius(t: number): number {
  return FAR_LAND_INNER_RADIUS * Math.pow(FAR_LAND_OUTER_RADIUS / FAR_LAND_INNER_RADIUS, t);
}

/**
 * One azimuth-periodic noise field in 0..1.
 *
 * Sampled on a circle so the fan closes exactly at the seam. The fold to 0..1
 * is clamped rather than merely scaled: mapping -1..1 into 0..1 is only a
 * guarantee while `noise2` stays inside ±1, which is a property of a sum of
 * sines in `materials.ts` that nothing there promises or tests. The clamp makes
 * every band below hold whatever that function later does, so this file's
 * invariants do not rest on another module's incidental range.
 */
function azField(az: number, scale: number, phase: number): number {
  const n = noise2(Math.cos(az) * scale + phase, Math.sin(az) * scale);
  return Math.min(1, Math.max(0, 0.5 + 0.5 * n));
}

/**
 * One cone of the profile: `A` metres tall at the outer radius, sunk `b` metres
 * at the eye's own position.
 *
 * Its elevation from an eye `e` above the anchor is `atan((A + b)/R - (b + e)/r)`,
 * which increases with `r` for every `b >= 0` and every `e >= 0`. That is the
 * monotonicity the whole profile inherits.
 */
function cone(r: number, top: number, sink: number): number {
  const u = r / FAR_LAND_OUTER_RADIUS;
  return top * u - sink * (1 - u);
}

/**
 * Height of the surface at radius `r` and azimuth `az`, metres above the ground
 * anchor (which is the ground under the camera, not the eye).
 *
 * The upper envelope of the rim plane, the spur and the range — see the module
 * comment. Every piece has an elevation that rises with radius, and the upper
 * envelope of such pieces does too, so the surface never overlaps itself.
 */
export function farLandHeightAt(r: number, az: number): number {
  const range = cone(
    r,
    FAR_LAND_RIDGE_HEIGHT + FAR_LAND_RIDGE_RELIEF * azField(az, FAR_LAND_RIDGE_NOISE_SCALE, 0),
    FAR_LAND_RANGE_SINK + FAR_LAND_RANGE_SINK_RELIEF * azField(az, FAR_LAND_SINK_NOISE_SCALE, 3.7),
  );
  const spur = cone(
    r,
    FAR_LAND_SPUR_HEIGHT + FAR_LAND_SPUR_RELIEF * azField(az, FAR_LAND_SPUR_NOISE_SCALE, 11.3),
    FAR_LAND_SPUR_SINK +
      FAR_LAND_SPUR_SINK_RELIEF * azField(az, FAR_LAND_SPUR_SINK_NOISE_SCALE, 19.1),
  );
  return Math.max(-FAR_LAND_RIM_DROP, Math.max(range, spur));
}

/** Height of ring `t` at azimuth `az`, metres above the ground anchor. */
export function farLandHeight(t: number, az: number): number {
  return farLandHeightAt(farLandRadius(t), az);
}

/**
 * Elevation of ring `t` at azimuth `az` as seen from an eye `eye` metres above
 * the ground anchor, radians. Rises monotonically in `t` for every `eye >= 0`.
 */
export function farLandElevation(t: number, az: number, eye: number): number {
  return Math.atan2(farLandHeight(t, az) - eye, farLandRadius(t));
}

/**
 * Outward-facing surface normal at ring `t`, azimuth `az`, written into `out`.
 *
 * Central differences on the height field in radius and azimuth, leaned back
 * toward vertical by `FAR_LAND_NORMAL_SOFTEN`. Differencing across the creases
 * rather than reading each cone's own slope is deliberate: it rounds the crest
 * over one ring instead of stamping a hard edge onto a surface whose radial
 * sampling is coarse out there.
 */
export function farLandNormal(t: number, az: number, out: THREE.Vector3): THREE.Vector3 {
  const r = farLandRadius(t);
  const dr = Math.max(1, r * 0.03);
  const da = 0.03;
  const dhdr = (farLandHeightAt(r + dr, az) - farLandHeightAt(r - dr, az)) / (2 * dr);
  const dhda = (farLandHeightAt(r, az + da) - farLandHeightAt(r, az - da)) / (2 * da * r);
  // Geometry is x = sin(az) * r, z = cos(az) * r, so the outward radial is
  // (sin az, 0, cos az) and the tangent is its azimuth derivative.
  const sa = Math.sin(az);
  const ca = Math.cos(az);
  out.set(-dhdr * sa - dhda * ca, 1, -dhdr * ca + dhda * sa).normalize();
  out.y += FAR_LAND_NORMAL_SOFTEN;
  return out.normalize();
}

/** Build the fan's geometry. Called once; the mesh is never rebuilt. */
export function buildFarLandGeometry(): THREE.BufferGeometry {
  const rings = FAR_LAND_RINGS;
  const segs = FAR_LAND_SEGMENTS;
  const count = rings * segs;
  const pos = new Float32Array(count * 3);
  const norm = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const n = new THREE.Vector3();

  for (let i = 0; i < rings; i++) {
    const t = i / (rings - 1);
    const r = farLandRadius(t);
    for (let j = 0; j < segs; j++) {
      const az = (j / segs) * Math.PI * 2;
      const k = (i * segs + j) * 3;
      pos[k] = Math.sin(az) * r;
      pos[k + 1] = farLandHeightAt(r, az);
      pos[k + 2] = Math.cos(az) * r;
      farLandNormal(t, az, n);
      norm[k] = n.x;
      norm[k + 1] = n.y;
      norm[k + 2] = n.z;
      // Patchwork: one noise walked outward on a growing circle, so it varies
      // in radius as well as azimuth and still closes at the seam. Without it
      // the open ground between the creases is a single flat tone.
      const ring = 5 + 26 * t;
      const v = 1 + noise2(Math.cos(az) * ring, Math.sin(az) * ring) * FAR_LAND_TINT_RELIEF;
      col[k] = v;
      col[k + 1] = v;
      col[k + 2] = v;
    }
  }

  // Outermost ring first. The camera sits at the fan's centre, so screen
  // azimuth is ring azimuth and depth order is radius order exactly — emitting
  // far to near makes the draw correct by painter's algorithm alone, which is
  // what lets the mesh skip depth writes.
  const idx = new Uint32Array((rings - 1) * segs * 6);
  let m = 0;
  for (let i = rings - 2; i >= 0; i--) {
    for (let j = 0; j < segs; j++) {
      const j2 = (j + 1) % segs;
      const a = i * segs + j;
      const b = i * segs + j2;
      const c = (i + 1) * segs + j;
      const d = (i + 1) * segs + j2;
      idx[m++] = a;
      idx[m++] = c;
      idx[m++] = b;
      idx[m++] = b;
      idx[m++] = c;
      idx[m++] = d;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  return geo;
}

/**
 * One draw call of distant land, standing on the ground under the camera. Add
 * it once, call `update` every frame; it rebuilds no geometry and does no
 * per-chunk work. It is not allocation-free: the biome blend it calls allocates
 * per call — that is `biomeAt`'s, tracked separately, not this module's to fix.
 */
export class FarLand {
  readonly mesh: THREE.Mesh;
  private mat: THREE.MeshToonMaterial;
  /** Damped ground height the fan is standing on, world Y. */
  private groundY = 0;
  private anchored = false;
  /** Vantage the anchor was last sampled at, for cut detection. */
  private lastS = 0;
  private lastLat = 0;

  constructor(private scene: THREE.Scene) {
    this.mat = new THREE.MeshToonMaterial({
      color: 0xffffff,
      vertexColors: true,
      gradientMap: toonRamp(),
      // The ridge is above the eye, so its underside faces the camera; the rim
      // is below and shows its top. One mesh sees both.
      side: THREE.DoubleSide,
      // Never occlude: the fan draws first and leaves the depth buffer alone,
      // so every real mesh paints over it and there is no seam to z-fight.
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(buildFarLandGeometry(), this.mat);
    this.mesh.name = 'farLand';
    // Centred on the camera and 8 km across, so it always intersects the
    // frustum — the test can only cost time.
    this.mesh.frustumCulled = false;
    // Between the sky dome (-10) and the sun/moon discs (-9), and well before
    // all world geometry (0). Ahead of the sun is not cosmetic ordering, it is
    // required: `GodRaysEffect` mutates the sun disc's material to
    // `transparent: true, depthWrite: false` when it is constructed, which
    // moves the disc into three's transparent pass and lets it draw over this
    // opaque fan. On `quality: 'low'` the effect is never constructed, the
    // disc stays opaque, and a fan ordered after it paints it out entirely —
    // measured: the disc vanishes at peak golden, whose elevation of 2.86°
    // puts its top edge at 8.08°, inside this fan's ridge band. Drawing the
    // fan first makes every quality tier agree, with the sun in front of the
    // haze as it already is at medium and high.
    this.mesh.renderOrder = -9.5;
    scene.add(this.mesh);
  }

  /**
   * Stand the fan on the ground under the camera and take the biome's ground
   * tone there — the same blend the terrain ribbon colours itself from.
   *
   * `camPos` must be the camera's position *this* frame, after any
   * floating-origin rebase (§5.2). The rebase shifts X and Z only, so the
   * sampled height needs no rebase handling of its own.
   *
   * `camS`/`camLat` are the vantage in road coordinates — where the ground is
   * sampled, and what a cut is detected in. In attract mode they are the
   * director's own, and must be: `roadsideStatic` stands as much as
   * `MENU_MAX_LEAD` = 260 m down the road from the car, over land of its own
   * height. In play the caller passes the *car's*, and that stands in for the
   * chase rig on purpose. The rig trails 9.5-12.7 m behind the car on the road
   * itself, where `|lat| < 6.2` puts the terrain flat on the road surface, so
   * the two samples differ only by the road's own grade over that gap —
   * bounded by the maximum slope the generator can produce, 0.071, giving
   * 0.9 m. That is well inside `FAR_LAND_RIM_DROP` = 5 m, which is the margin
   * that decides whether any of this can surface, so the rig gains nothing
   * from an accessor of its own.
   */
  update(path: RoadPath, camPos: THREE.Vector3, camS: number, camLat: number, dt: number): void {
    const ground = terrainMeshHeight(path, camS, camLat);
    // A cut is a jump in the vantage, not in the height it lands on.
    const jumped = Math.hypot(camS - this.lastS, camLat - this.lastLat) > FAR_LAND_CUT_DISTANCE;
    this.lastS = camS;
    this.lastLat = camLat;
    if (!this.anchored || jumped) {
      this.groundY = ground;
      this.anchored = true;
    } else {
      this.groundY = THREE.MathUtils.damp(this.groundY, ground, FAR_LAND_ANCHOR_DAMP, dt);
    }
    this.mesh.position.set(camPos.x, this.groundY, camPos.z);
    blendColor(camS, GROUND, this.mat.color);
  }

  /**
   * Drop the anchor so the next `update` takes its ground sample raw.
   *
   * For the one discontinuity the cut detection in `update` cannot see:
   * `RoadPath.reset` re-bases the curve at a new origin, so the *world* the
   * heights are measured in changes underneath the anchor and the height it is
   * holding no longer refers to anything. `main.ts` calls this from
   * `seedWorldAt`, alongside the other resets a teleport owes (RoadPath,
   * ChunkManager, Pickups).
   */
  reanchor(): void {
    this.anchored = false;
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}
