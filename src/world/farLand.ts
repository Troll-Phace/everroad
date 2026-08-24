import * as THREE from 'three';
import { blendColor, type BiomeVisual } from './biomes';
import { noise2, toonRamp } from './materials';

/**
 * The land beyond the terrain ribbon.
 *
 * The ribbon (`chunks.ts`, §5.3) is swept along the road curve and stops at
 * `TER_COLS` ±165 m, so a near-horizontal sight line runs out over the fields,
 * leaves the ribbon a metre or two above the surface and finds nothing to hit.
 * Rendering the live scene's own chunk meshes to an off-screen mask at
 * 1280x800 and counting sky pixels that have scene geometry above them in the
 * same column, that is 219 px in 106 thin runs at the sunflower-coast repro —
 * sky sitting between the land silhouette and the canopies just above it, the
 * "floating distant trees" report. With this backdrop the count is 0 there and
 * at every other position measured on unfolded road.
 *
 * That last qualifier is load-bearing. A cell folds exactly when `|lat| >= R`,
 * so wherever the radius of curvature drops under 165 m the outermost
 * `TER_COLS` column exceeds it, `1 - k*lat` goes negative and the far field
 * inverts; under 115 m the next column goes too. At s = 21040 (R 95.9) that
 * throws whole trees into the sky, measured at 12-16° elevation and tens of
 * metres above the ground beneath them, detached from any surface (#39). Sky under
 * *that* is not this bug and no horizon can close it — see §5.3's note on the
 * crumpled far field. Measure with the scenery meshes hidden to see this
 * module's own behaviour separately from it.
 *
 * Widening the ribbon cannot fix it: the road's minimum radius of curvature is
 * the analytic 87.7 m (`1 / (0.0042 + 0.0035 + 0.0028 + 0.0009)`, the sum of
 * `RoadPath.curvature`'s four sine amplitudes), so a path-space sweep past
 * ±165 m folds over itself. This backdrop is
 * therefore built in **world space, anchored to the camera** — a radial fan
 * centred on the camera that translates (never rotates) with it, the way
 * `Sky`'s dome does. Nothing about it follows the road curve, so nothing folds.
 *
 * Three properties make it safe:
 *
 * - It never writes depth and is drawn before every world mesh, so terrain and
 *   scenery always paint over it and there is no depth to fight at the join.
 *   It is not true that it occludes nothing: it deliberately covers the sky
 *   dome, and it is ordered ahead of the sun and moon precisely so it does
 *   *not* cover those — see `renderOrder` in the constructor.
 * - Its elevation angle rises monotonically with radius (see
 *   `farLandBaseAngle`), so the surface never overlaps itself from the camera
 *   at the centre, and — being continuous — it covers *every* angle between
 *   `FAR_LAND_INNER_ANGLE_DEG` and the ridge without gaps.
 * - It reads as haze rather than as an object because `FogExp2` does most of
 *   the work. That is not uniform across it, and the difference matters: the
 *   ridge, out past 2 km, is fogged to saturation and is pure fog colour, but
 *   the part that actually plugs a horizon-grazing sight line is much nearer —
 *   a ray at -0.5° to 1° meets the fan at 320-400 m, only ~77-90% fogged
 *   radially, and three.js fogs on view-space depth, so at the frame edge it
 *   is nearer ~55-60%. Its own colour therefore shows through there, which is
 *   correct — that band should read as terrain continuing, not as haze. The
 *   biome blend in `update` is doing real work; it is not insurance.
 */

/**
 * Innermost radius, metres. Must sit inside the ribbon in every direction so
 * the fan's inner rim is always buried under real terrain: the ribbon reaches
 * ±165 m laterally and `BEHIND * CHUNK_LEN` = 180 m behind the car.
 */
export const FAR_LAND_INNER_RADIUS = 120;

/**
 * Outermost radius, metres. Inside the sky dome (6000) and the camera's far
 * plane (9000); far enough that the ridge is fully fogged.
 */
export const FAR_LAND_OUTER_RADIUS = 4000;

/**
 * Elevation of the inner rim, degrees below the eye. Any ray steeper down than
 * this from a camera ~5 m over the road reaches the ground within ~120 m —
 * inside the ribbon — so nothing can show under the rim. Measured worst-case
 * terrain 120 m out is ~10.2° below the eye, which this clears.
 */
export const FAR_LAND_INNER_ANGLE_DEG = -10;

/**
 * **Floor** elevation of the ridge, degrees above the eye — the lowest the
 * silhouette reaches at any azimuth. This is the number that decides the fix:
 * the backdrop closes every sky gap below it, and nothing above it.
 *
 * Measured against the live scene, gaps start at 1.6° (the land silhouette
 * itself). How high they reach is set by curvature: on a straight the land
 * silhouette tops out near 5.5°, but the tighter the bend the nearer the
 * ribbon edge on its outside and the higher its silhouette, and at the road's
 * genuinely tightest bends — R 92.4 at s ~21.1 km, R 91.3 at s ~99.1 km,
 * R 88.7 at s ~431.6 km, against an analytic minimum of 87.7 m — it reaches
 * 6.64°. The floor clears that by ~1°, deliberately: those are the tightest
 * bends in 460 km of road, the trend against curvature is monotonic, and the
 * headroom is cheaper than re-deriving this from a screenshot later.
 *
 * Do not tune this down against a mid-biome screenshot on a straight. That is
 * not the case that sets it. Sample a bend of known radius — `RoadPath`'s
 * curvature is a closed-form sum of four sines, so R is exactly 1/|k(s)| and
 * can be solved for rather than guessed at.
 */
export const FAR_LAND_RIDGE_ANGLE_DEG = 7.6;

/**
 * How far the ridge wanders **above** the floor, degrees. Without a wander the
 * silhouette is a cone of constant elevation, which projects to a
 * dead-straight line and reads as a lid rather than as land. It is wider than
 * it needs to be for that: the wander has to stay a visible fraction of the
 * ridge's height over the horizon, and once the floor rose to clear the
 * tightest bend, 0.9° here had flattened into a band.
 *
 * The wander is deliberately **one-sided** — `farLandAngle` maps the noise to
 * 0..1 rather than -1..1, so the ridge occupies [floor, floor + this] and is
 * never below the floor at any azimuth. Do not "clean this up" into a
 * symmetric ±wander: that drops the silhouette a full wander below the floor
 * on part of the circle, and whether a gap survives then depends on which
 * azimuth the dip happens to land on — closure by luck rather than by
 * construction, and a horizon that is whole except on the outside of a tight
 * bend reads as unfixed and is far harder to diagnose the second time. Folding
 * the noise upward costs half a wander of mean ridge height; getting the same
 * floor out of a symmetric wander would cost a whole one.
 *
 * Kept under the ridge profile's own slope at the rim so the elevation stays
 * monotonic in radius (see `farLandBaseAngle`).
 */
export const FAR_LAND_RIDGE_NOISE_DEG = 1.4;

/**
 * Radius walked through `noise2` around the azimuth circle. Sampling the noise
 * at (cos az, sin az) makes it exactly periodic, so the fan has no seam; this
 * scale sets how many undulations fit around the horizon (21, so ~5 across the
 * ~88° the camera sees).
 */
export const FAR_LAND_NOISE_SCALE = 24;

/** Radial rings. Half of them land in the band that is actually visible. */
export const FAR_LAND_RINGS = 14;

/** Azimuth divisions. 96 keeps the ridge smooth at the frame edges. */
export const FAR_LAND_SEGMENTS = 96;

const GROUND = (b: BiomeVisual): string => b.ground;

/** Radius of ring parameter `t` (0 = inner rim, 1 = ridge), metres. */
export function farLandRadius(t: number): number {
  return FAR_LAND_INNER_RADIUS * Math.pow(FAR_LAND_OUTER_RADIUS / FAR_LAND_INNER_RADIUS, t);
}

/**
 * Mean elevation angle of ring `t`, radians.
 *
 * The easing rushes through the low angles — everything under the land
 * silhouette is wasted geometry — while keeping the slope at the ridge well
 * above the noise term's own slope, which is what guarantees the profile stays
 * monotonic once the ridge wander is added.
 */
export function farLandBaseAngle(t: number): number {
  const eased = 0.25 * t + 0.75 * (1 - Math.pow(1 - t, 3));
  return THREE.MathUtils.degToRad(
    FAR_LAND_INNER_ANGLE_DEG + (FAR_LAND_RIDGE_ANGLE_DEG - FAR_LAND_INNER_ANGLE_DEG) * eased,
  );
}

/**
 * Elevation angle at ring `t` and azimuth `az`, radians.
 *
 * The noise is folded to 0..1, not -1..1: the ridge wanders upward off
 * `FAR_LAND_RIDGE_ANGLE_DEG` and never below it, which is what makes the
 * closure a guarantee rather than a coincidence of azimuth. The `t * t` weight
 * takes the wander to exactly zero at the inner rim, so the rim stays a known
 * angle that the terrain is certain to bury.
 *
 * The fold is clamped rather than merely scaled. Mapping -1..1 into 0..1 is
 * only a guarantee while `noise2` stays inside +/-1, which is a property of a
 * sum of sines in `materials.ts` that nothing there promises or tests. The
 * clamp makes the band [floor, floor + wander] hold whatever that function
 * later does, so this file's invariant does not rest on another module's
 * incidental range.
 */
export function farLandAngle(t: number, az: number): number {
  const n = noise2(Math.cos(az) * FAR_LAND_NOISE_SCALE, Math.sin(az) * FAR_LAND_NOISE_SCALE);
  const wander = Math.min(1, Math.max(0, 0.5 + 0.5 * n));
  return farLandBaseAngle(t) + THREE.MathUtils.degToRad(FAR_LAND_RIDGE_NOISE_DEG) * t * t * wander;
}

/** Height of ring `t` at azimuth `az`, metres relative to the camera. */
export function farLandHeight(t: number, az: number): number {
  return farLandRadius(t) * Math.tan(farLandAngle(t, az));
}

/** Build the fan's geometry. Called once; the mesh is never rebuilt. */
export function buildFarLandGeometry(): THREE.BufferGeometry {
  const rings = FAR_LAND_RINGS;
  const segs = FAR_LAND_SEGMENTS;
  const count = rings * segs;
  const pos = new Float32Array(count * 3);
  const norm = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);

  for (let i = 0; i < rings; i++) {
    const t = i / (rings - 1);
    const r = farLandRadius(t);
    for (let j = 0; j < segs; j++) {
      const az = (j / segs) * Math.PI * 2;
      const k = (i * segs + j) * 3;
      pos[k] = Math.sin(az) * r;
      pos[k + 1] = farLandHeight(t, az);
      pos[k + 2] = Math.cos(az) * r;
      // Flat land normals: the fan is nearly horizontal, and matching the
      // ribbon's far field exactly keeps the toon ramp on the same step.
      norm[k + 1] = 1;
      const v = 1 + noise2(az * 3, t * 7) * 0.05;
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
  let n = 0;
  for (let i = rings - 2; i >= 0; i--) {
    for (let j = 0; j < segs; j++) {
      const j2 = (j + 1) % segs;
      const a = i * segs + j;
      const b = i * segs + j2;
      const c = (i + 1) * segs + j;
      const d = (i + 1) * segs + j2;
      idx[n++] = a;
      idx[n++] = c;
      idx[n++] = b;
      idx[n++] = b;
      idx[n++] = c;
      idx[n++] = d;
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
 * One draw call of distant land, anchored to the camera. Add it once, call
 * `update` every frame; it rebuilds no geometry and does no per-chunk work.
 * It is not allocation-free: the biome blend it calls allocates per call —
 * that is `biomeAt`'s, tracked separately, not this module's to fix.
 */
export class FarLand {
  readonly mesh: THREE.Mesh;
  private mat: THREE.MeshToonMaterial;

  constructor(private scene: THREE.Scene) {
    this.mat = new THREE.MeshToonMaterial({
      color: 0xffffff,
      vertexColors: true,
      gradientMap: toonRamp(),
      // The ridge is above the eye, so its underside faces the camera; the
      // inner rim is below and shows its top. One mesh sees both.
      side: THREE.DoubleSide,
      // Never occlude: the fan draws first and leaves the depth buffer alone,
      // so every real mesh paints over it and there is no seam to z-fight.
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(buildFarLandGeometry(), this.mat);
    this.mesh.name = 'farLand';
    // Centred on the camera and 4 km across, so it always intersects the
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
   * Follow the camera and take the biome's ground tone at `pathS`, the same
   * blend the terrain ribbon colours itself from. `camPos` must be the
   * camera's position *this* frame, after any floating-origin rebase (§5.2).
   */
  update(camPos: THREE.Vector3, pathS: number): void {
    this.mesh.position.copy(camPos);
    blendColor(pathS, GROUND, this.mat.color);
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}
