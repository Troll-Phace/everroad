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

  /** Curvature (1/radius) at distance s. Max ~1/85m. */
  private curvature(s: number): number {
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

  /** Drop samples earlier than s (keep a small margin). */
  prune(s: number): void {
    const margin = 400;
    const dropCount = Math.floor((s - margin - this.baseS) / DS);
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

  /** World position at (s, lateral). lateral > 0 = right of travel direction. */
  point(s: number, lateral: number, out?: THREE.Vector3): THREE.Vector3 {
    const p = this.pose(s, this.scratch);
    const res = out ?? new THREE.Vector3();
    // Right-hand normal of heading: forward is (sin h, cos h), so the
    // traveler's right is (-cos h, sin h).
    const nx = -Math.cos(p.heading);
    const nz = Math.sin(p.heading);
    res.set(p.pos.x + nx * lateral, p.pos.y, p.pos.z + nz * lateral);
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
