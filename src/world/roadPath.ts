import * as THREE from 'three';

/**
 * The infinite road: a 1-D parametric curve s -> (position, heading).
 * Built by integrating a smoothly-varying curvature signal (sums of sines),
 * so it never repeats yet stays gentle. Elevation rolls the same way.
 *
 * Samples are stored every DS meters in a ring buffer; the world only ever
 * needs a ~2.5 km window. Positions are in world space and get shifted when
 * the floating origin rebases.
 */

export const DS = 2; // meters between samples
export const ROAD_HALF_WIDTH = 4.6; // full road ~9.2m (two lanes + shoulders)
export const LANE_OFFSET = 2.1; // center of right lane

/**
 * Fraction of the local radius of curvature at which the lateral map starts
 * giving ground back, and the fraction it may never exceed.
 *
 * The offset map `P(s) + N(s)*lat` stretches by `1 + k*lat` per metre of s, so
 * on the inside of a bend it collapses to a point at `lat = -1/k` and turns
 * itself inside out beyond that. The road's curvature is a closed-form sum of
 * four sines, so the tightest bend it can produce is exactly
 * `1 / (0.0042 + 0.0035 + 0.0028 + 0.0009)` = 87.7 m — well inside the +/-165 m
 * the terrain ribbon reaches, which is why the far field used to crumple.
 *
 * There is no widening out of it: the ground on the inside of a bend simply
 * is not 165 m of ground, it is a disc of radius R, and any map that claims
 * otherwise covers the same dirt twice. So the far columns compress instead,
 * smoothly, asymptoting to FOLD_LIMIT of the radius and never reaching it. The
 * stretch factor therefore stays above `1 - FOLD_LIMIT` everywhere and no cell
 * can invert (docs/ARCHITECTURE.md 5.3).
 */
export const FOLD_START = 0.6;
export const FOLD_LIMIT = 0.85;

/**
 * The lateral offset the world is actually built at, given the local curvature.
 *
 * Identity while `|k*lat|` stays under FOLD_START — which covers the road, the
 * car, every pickup and the near field at every curvature the generator can
 * produce — then compresses the inside-of-bend columns onto an asymptote at
 * FOLD_LIMIT of the radius. C1 at the handover and monotone in `lateral`, so
 * the terrain grid stays continuous and keeps its winding.
 */
export function foldSafeLateral(curvature: number, lateral: number): number {
  const w = curvature * lateral;
  // Positive w is the outside of the bend: it stretches, and never folds.
  if (w >= -FOLD_START) return lateral;
  const range = FOLD_LIMIT - FOLD_START;
  const excess = -w - FOLD_START;
  const wEff = -(FOLD_START + range * (1 - Math.exp(-excess / range)));
  return wEff / curvature;
}

interface Sample {
  x: number;
  y: number;
  z: number;
  heading: number;
}

export class RoadPath {
  private samples: Sample[] = [];
  /** s value of samples[0]. */
  private baseS = 0;
  private seed: number;

  constructor(seed = 1337) {
    this.seed = seed;
    this.samples.push({ x: 0, y: 0, z: 0, heading: 0 });
  }

  /**
   * Curvature (1/radius) at distance s. Closed form, so the radius of any
   * point on the road is exactly `1 / |curvature(s)|` — derive it rather than
   * sampling it, and check it before calling a stretch of road tight.
   * Bounded by the sum of the four amplitudes: |k| <= 1/87.7 m.
   */
  curvature(s: number): number {
    const k =
      Math.sin(s * 0.0031 + this.seed * 0.71) * 0.0042 +
      Math.sin(s * 0.00117 + this.seed * 1.93) * 0.0035 +
      Math.sin(s * 0.00053 + this.seed * 4.07) * 0.0028 +
      Math.sin(s * 0.0089 + this.seed * 2.61) * 0.0009;
    return k;
  }

  /** Elevation slope at distance s (rise per meter). Rolling hills. */
  private slope(s: number): number {
    return (
      Math.sin(s * 0.0021 + this.seed * 3.1) * 0.028 +
      Math.sin(s * 0.00072 + this.seed * 5.7) * 0.035 +
      Math.sin(s * 0.0058 + this.seed * 1.3) * 0.008
    );
  }

  /** Ensure samples exist up to at least s. */
  ensure(s: number): void {
    let lastIdx = this.samples.length - 1;
    let lastS = this.baseS + lastIdx * DS;
    while (lastS < s) {
      const last = this.samples[lastIdx];
      const nextS = lastS + DS;
      const heading = last.heading + this.curvature(lastS) * DS;
      const x = last.x + Math.sin(heading) * DS;
      const z = last.z + Math.cos(heading) * DS;
      const y = last.y + this.slope(lastS) * DS;
      this.samples.push({ x, y, z, heading });
      lastIdx++;
      lastS = nextS;
    }
  }

  /**
   * Re-seed the curve at path distance `s`, discarding every stored sample.
   *
   * Curvature and slope are pure functions of `s`, so the road built from here
   * is the authentic road for that stretch; only its world-space origin moves
   * (the new first sample sits at the origin heading +Z, exactly like a fresh
   * path). Needed because `pose()` clamps to the retained window: teleporting
   * the car *backwards* along the road — menu re-seed, or starting a journey
   * at START_S after attract mode ran twenty kilometres out — would otherwise
   * collapse every lookup onto samples[0].
   *
   * Callers must drop anything holding world positions or absolute s values in
   * the same breath (ChunkManager.reset, Pickups.reset) — see main.ts.
   *
   * Ends by growing the second sample: `pose()` interpolates between a pair,
   * so a one-sample buffer is a window in which any lookup at or below `s`
   * would read past the end of the array (see the guard there).
   */
  reset(s: number): void {
    this.samples.length = 0;
    this.baseS = s;
    this.samples.push({ x: 0, y: 0, z: 0, heading: 0 });
    this.ensure(s + DS);
  }

  /**
   * Drop samples earlier than s (keep a small margin).
   *
   * The drop is clamped against what is actually stored: a prune far past the
   * ensured window would otherwise splice the buffer empty, and every later
   * `pose()` would read `samples[0]` as undefined and throw from inside the
   * rAF loop. `baseS` always follows whatever survives, so the retained
   * samples keep their true s.
   */
  prune(s: number): void {
    const margin = 400;
    const wanted = Math.floor((s - margin - this.baseS) / DS);
    // pose() interpolates between a pair, so never leave fewer than two.
    const dropCount = Math.min(wanted, this.samples.length - 2);
    if (dropCount > 200) {
      this.samples.splice(0, dropCount);
      this.baseS += dropCount * DS;
    }
  }

  /** Shift all stored samples by (dx, dz) — floating-origin rebase. */
  shiftOrigin(dx: number, dz: number): void {
    for (const p of this.samples) {
      p.x += dx;
      p.z += dz;
    }
  }

  /** Interpolated centerline pose at s. */
  pose(
    s: number,
    out?: { pos: THREE.Vector3; heading: number },
  ): { pos: THREE.Vector3; heading: number } {
    this.ensure(s + DS);
    const res = out ?? { pos: new THREE.Vector3(), heading: 0 };
    // Below baseS, `ensure` grows nothing, so a one-sample buffer has no pair
    // to interpolate and `samples[i + 1]` would be undefined. `reset` keeps a
    // second sample for exactly this reason; a freshly constructed path is
    // still one sample until something asks for road ahead of it.
    if (this.samples.length < 2) {
      const only = this.samples[0];
      res.pos.set(only.x, only.y, only.z);
      res.heading = only.heading;
      return res;
    }
    const f = (s - this.baseS) / DS;
    const i = THREE.MathUtils.clamp(Math.floor(f), 0, this.samples.length - 2);
    const t = THREE.MathUtils.clamp(f - i, 0, 1);
    const a = this.samples[i];
    const b = this.samples[i + 1];
    res.pos.set(
      THREE.MathUtils.lerp(a.x, b.x, t),
      THREE.MathUtils.lerp(a.y, b.y, t),
      THREE.MathUtils.lerp(a.z, b.z, t),
    );
    res.heading = a.heading + (b.heading - a.heading) * t;
    return res;
  }

  /**
   * The lateral offset (s, lateral) is really built at, after the far-field
   * compression that keeps the offset map from folding. Identity for anything
   * inside FOLD_START of the local radius — the road, the car, pickups, the
   * near field — so callers there can ignore it. Anything that has to agree
   * with `point` about where a lateral landed (terrain heights, terrain
   * colour) must ask for this rather than using the raw offset.
   */
  effectiveLateral(s: number, lateral: number): number {
    return foldSafeLateral(this.curvature(s), lateral);
  }

  /**
   * World position at (s, lateral). lateral > 0 = right of travel direction.
   *
   * Costs a `curvature(s)` — four `Math.sin` — on top of the pose lookup,
   * because the offset has to be fold-corrected. A loop walking a whole grid
   * row at one `s` should hoist that out: take `curvature(s)` once, run the
   * columns through `foldSafeLateral`, and call `pointAtEffective`. Measured
   * on the terrain and road grids, that is the difference between ~180 us and
   * ~20 us of vertex placement per chunk.
   */
  point(s: number, lateral: number, out?: THREE.Vector3): THREE.Vector3 {
    return this.pointAtEffective(s, foldSafeLateral(this.curvature(s), lateral), out);
  }

  /**
   * World position at (s, effectiveLateral), skipping the fold correction
   * because the caller has already applied it.
   *
   * `effectiveLateral` must be a value that came out of `foldSafeLateral` (or
   * `effectiveLateral()`) for *this* `s` — passing a raw offset here puts the
   * point somewhere `point()` would never have put it, which is precisely the
   * fold this whole mechanism exists to prevent. Exists for the grid builders,
   * which place a row of columns at one `s` and would otherwise recompute the
   * same curvature once per column.
   */
  pointAtEffective(s: number, effectiveLateral: number, out?: THREE.Vector3): THREE.Vector3 {
    const p = this.pose(s, this.scratch);
    const res = out ?? new THREE.Vector3();
    // Right-hand normal of heading: forward is (sin h, cos h), so the
    // traveler's right is (-cos h, sin h).
    const nx = -Math.cos(p.heading);
    const nz = Math.sin(p.heading);
    res.set(p.pos.x + nx * effectiveLateral, p.pos.y, p.pos.z + nz * effectiveLateral);
    return res;
  }

  private scratch = { pos: new THREE.Vector3(), heading: 0 };

  heading(s: number): number {
    return this.pose(s, this.scratch).heading;
  }

  elevation(s: number): number {
    return this.pose(s, this.scratch).pos.y;
  }
}
