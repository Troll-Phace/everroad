import { describe, it, expect } from 'vitest';
import { DS, FOLD_LIMIT, FOLD_START, RoadPath, foldSafeLateral } from './roadPath';

const SEED = 20260824;

/**
 * Drive a path out to `toS` the way ChunkManager does: grow the window ahead
 * of the car and prune behind it, so the retained samples end up far past the
 * stretch a menu re-seed jumps back to.
 */
function driveTo(path: RoadPath, toS: number): void {
  for (let s = 0; s <= toS; s += 60) {
    path.ensure(s + 80);
    path.prune(s - 280);
  }
}

describe('RoadPath determinism', () => {
  it('produces identical poses for the same seed regardless of ensure cadence', () => {
    const a = new RoadPath(SEED);
    a.ensure(5000);

    const b = new RoadPath(SEED);
    for (let s = 0; s <= 5000; s += 137) b.ensure(s);
    b.ensure(5000);

    for (let s = 0; s <= 4900; s += 250) {
      const pa = a.pose(s);
      const pb = b.pose(s);
      expect(pb.pos.x).toBeCloseTo(pa.pos.x, 9);
      expect(pb.pos.y).toBeCloseTo(pa.pos.y, 9);
      expect(pb.pos.z).toBeCloseTo(pa.pos.z, 9);
      expect(pb.heading).toBeCloseTo(pa.heading, 9);
    }
  });

  it('diverges for different seeds', () => {
    const a = new RoadPath(1);
    const b = new RoadPath(2);
    a.ensure(2000);
    b.ensure(2000);
    const pa = a.pose(1500);
    const pb = b.pose(1500);
    expect(Math.abs(pa.pos.x - pb.pos.x) + Math.abs(pa.pos.z - pb.pos.z)).toBeGreaterThan(1);
  });
});

describe('RoadPath.shiftOrigin', () => {
  it('translates every existing sample by exactly (dx, dz)', () => {
    const a = new RoadPath(SEED);
    const b = new RoadPath(SEED);
    a.ensure(4000);
    b.ensure(4000);
    b.shiftOrigin(-1234, 987);
    for (let s = 0; s <= 3900; s += 300) {
      const pa = a.pose(s);
      const pb = b.pose(s);
      expect(pb.pos.x).toBeCloseTo(pa.pos.x - 1234, 9);
      expect(pb.pos.z).toBeCloseTo(pa.pos.z + 987, 9);
      expect(pb.pos.y).toBeCloseTo(pa.pos.y, 9);
      expect(pb.heading).toBeCloseTo(pa.heading, 9);
    }
  });

  it('keeps samples generated after a rebase consistent with the shifted frame', () => {
    const a = new RoadPath(SEED);
    a.ensure(6000);

    const b = new RoadPath(SEED);
    b.ensure(3000);
    b.shiftOrigin(-500, -400); // rebase mid-drive
    b.ensure(6000); // growth continues from the shifted last sample

    const pa = a.pose(5800);
    const pb = b.pose(5800);
    expect(pb.pos.x).toBeCloseTo(pa.pos.x - 500, 9);
    expect(pb.pos.z).toBeCloseTo(pa.pos.z - 400, 9);
    expect(pb.heading).toBeCloseTo(pa.heading, 9);
  });
});

describe('RoadPath at large s', () => {
  it('keeps elevation and heading bounded out to 200 km', () => {
    const path = new RoadPath(SEED);
    let maxY = -Infinity;
    let minY = Infinity;
    let maxH = 0;
    for (let s = 0; s <= 200_000; s += 2000) {
      path.ensure(s + 100);
      path.prune(s - 500);
      const y = path.elevation(s);
      maxY = Math.max(maxY, y);
      minY = Math.min(minY, y);
      maxH = Math.max(maxH, Math.abs(path.heading(s)));
    }
    expect(maxY).toBeLessThan(120);
    expect(minY).toBeGreaterThan(-120);
    expect(maxH).toBeLessThan(30);
  });
});

describe('RoadPath.reset', () => {
  /** The re-seeded curve is the original rotated so the anchor sits at the
   * origin heading +Z, so compare against that rotation rather than against
   * raw world coordinates. */
  function expectReanchored(reset: RoadPath, ref: RoadPath, anchorS: number, s: number): void {
    const h0 = ref.heading(anchorS);
    const p0 = ref.pose(anchorS).pos.clone();
    const d = ref.pose(s).pos.clone().sub(p0);
    const got = reset.pose(s);
    expect(got.pos.x).toBeCloseTo(d.x * Math.cos(h0) - d.z * Math.sin(h0), 6);
    expect(got.pos.z).toBeCloseTo(d.z * Math.cos(h0) + d.x * Math.sin(h0), 6);
    expect(got.pos.y).toBeCloseTo(d.y, 6);
    expect(got.heading).toBeCloseTo(ref.heading(s) - h0, 9);
  }

  it('un-collapses lookups that a driven-away window had flattened onto one sample', () => {
    const path = new RoadPath(SEED);
    driveTo(path, 20000);

    // The retained window is 20 km down the road, so every lookup back at 5 km
    // clamps to the same stored sample: the road has no shape left there.
    const before = path.pose(5000).pos.clone();
    expect(path.pose(5600).pos.distanceTo(before)).toBeLessThan(1e-9);

    path.reset(4700);
    expect(path.pose(5600).pos.distanceTo(path.pose(5000).pos)).toBeGreaterThan(500);
  });

  it('rebuilds the authentic road for the stretch, re-anchored at s', () => {
    const path = new RoadPath(SEED);
    driveTo(path, 20000);
    path.reset(4700);

    const ref = new RoadPath(SEED);
    ref.ensure(6000);
    for (const s of [4700, 4800, 5000, 5400, 5900]) expectReanchored(path, ref, 4700, s);
  });

  it('anchors the first sample at the origin heading +Z, like a fresh path', () => {
    const path = new RoadPath(SEED);
    path.ensure(3000);
    path.reset(1200);
    const p = path.pose(1200);
    expect(p.pos.x).toBeCloseTo(0, 9);
    expect(p.pos.y).toBeCloseTo(0, 9);
    expect(p.pos.z).toBeCloseTo(0, 9);
    expect(p.heading).toBeCloseTo(0, 9);
  });

  it('leaves prune a no-op for the window the caller re-seeds into', () => {
    // What main.ts does: re-seed RESEED_MARGIN behind the car, ensure the road
    // under it, then let ChunkManager prune from the car's position.
    const path = new RoadPath(SEED);
    driveTo(path, 20000);
    path.reset(4700);
    path.ensure(5080);

    const probes = [4700, 4820, 5000];
    const beforePrune = probes.map((s) => path.pose(s).pos.clone());
    path.prune(5000 - 280);
    probes.forEach((s, i) => {
      expect(path.pose(s).pos.distanceTo(beforePrune[i])).toBe(0);
    });
  });

  it('returns the anchor pose for a lookup behind it rather than throwing', () => {
    const path = new RoadPath(SEED);
    path.ensure(9000);
    path.reset(8000);
    const p = path.pose(8000 - 100);
    expect(Number.isFinite(p.pos.x)).toBe(true);
    expect(Number.isFinite(p.pos.y)).toBe(true);
    expect(Number.isFinite(p.pos.z)).toBe(true);
    expect(Number.isFinite(p.heading)).toBe(true);
    expect(p.pos.distanceTo(path.pose(8000).pos)).toBeLessThan(DS);
  });

  it("survives a lookup below a freshly constructed path's single sample", () => {
    const p = new RoadPath(SEED).pose(-100);
    expect(Number.isFinite(p.pos.x)).toBe(true);
    expect(Number.isFinite(p.heading)).toBe(true);
  });
});

describe('RoadPath.prune', () => {
  it('leaves the retained road identical for a prune inside the window', () => {
    // The normal case, and the one with golden data hanging off it: clamping
    // dropCount must not change which samples a routine prune drops.
    const path = new RoadPath(SEED);
    const ref = new RoadPath(SEED);
    path.ensure(4000);
    ref.ensure(4000);
    path.prune(2000);
    for (let s = 2000; s <= 3900; s += 137) {
      const a = path.pose(s);
      const b = ref.pose(s);
      expect(a.pos.x).toBeCloseTo(b.pos.x, 9);
      expect(a.pos.y).toBeCloseTo(b.pos.y, 9);
      expect(a.pos.z).toBeCloseTo(b.pos.z, 9);
      expect(a.heading).toBeCloseTo(b.heading, 9);
    }
  });

  it('survives a prune far past the ensured window', () => {
    // Unreachable through ChunkManager, which only ever prunes behind the
    // ensured window — but the failure mode is `samples[0]` coming back
    // undefined and pose() throwing a TypeError from inside the rAF loop, so
    // the clamp is the guard rather than the caller's arithmetic (#42).
    const path = new RoadPath(SEED);
    path.ensure(500);
    path.prune(1e6);

    const p = path.pose(600);
    expect(Number.isFinite(p.pos.x)).toBe(true);
    expect(Number.isFinite(p.pos.y)).toBe(true);
    expect(Number.isFinite(p.pos.z)).toBe(true);
    expect(Number.isFinite(p.heading)).toBe(true);

    // baseS still describes whatever survived, so the road ahead is the real
    // road and not an offset copy of it.
    const ref = new RoadPath(SEED);
    ref.ensure(700);
    const q = ref.pose(600);
    expect(p.pos.x).toBeCloseTo(q.pos.x, 6);
    expect(p.pos.y).toBeCloseTo(q.pos.y, 6);
    expect(p.pos.z).toBeCloseTo(q.pos.z, 6);
    expect(p.heading).toBeCloseTo(q.heading, 9);
  });

  it('stays usable across repeated over-prunes', () => {
    const path = new RoadPath(SEED);
    path.ensure(500);
    for (let i = 0; i < 5; i++) {
      path.prune(1e6 + i);
      const p = path.pose(520 + i);
      expect(Number.isFinite(p.pos.x + p.pos.z + p.heading)).toBe(true);
    }
  });
});

describe('foldSafeLateral', () => {
  /** Tightest bend the generator can produce: 1 / sum of the four amplitudes. */
  const K_MAX = 0.0042 + 0.0035 + 0.0028 + 0.0009;
  /** The widest the terrain ribbon reaches (TER_COLS), plus slack. */
  const LAT_MAX = 200;

  it('is the identity across the road, the car and the near field', () => {
    // FOLD_START of the tightest possible radius is the widest offset that is
    // guaranteed untouched at every curvature — 52.6 m as the constants stand.
    const untouched = FOLD_START / K_MAX;
    expect(untouched).toBeGreaterThan(48);
    for (let k = -K_MAX; k <= K_MAX; k += K_MAX / 50) {
      for (const lat of [-48, -30, -10, -5.5, 0, 2.1, 5.5, 18, 48]) {
        expect(Math.abs(lat)).toBeLessThanOrEqual(untouched);
        expect(foldSafeLateral(k, lat)).toBe(lat);
      }
    }
  });

  it('never reaches the local radius of curvature', () => {
    // A cell folds exactly when |lat| >= R, so the whole defect is this bound.
    // FOLD_LIMIT is the design bound and the exact supremum, approached but
    // never attained — assert against the constant so loosening it fails here.
    let worst = 0;
    for (let k = -K_MAX; k <= K_MAX; k += K_MAX / 200) {
      for (let lat = -LAT_MAX; lat <= LAT_MAX; lat += 0.5) {
        worst = Math.max(worst, -k * foldSafeLateral(k, lat));
      }
    }
    expect(worst).toBeLessThan(FOLD_LIMIT);
    // ...and the bound is tight, so the test would notice the asymptote moving
    // in either direction rather than only upward.
    expect(worst).toBeGreaterThan(FOLD_LIMIT - 1e-3);
  });

  it('keeps the offset map stretching forward everywhere', () => {
    // d/ds of P(s) + N(s)*lat is (1 + k*lat) * tangent. Once that goes
    // negative the ribbon turns itself inside out.
    let worst = Infinity;
    for (let k = -K_MAX; k <= K_MAX; k += K_MAX / 200) {
      for (let lat = -LAT_MAX; lat <= LAT_MAX; lat += 0.5) {
        worst = Math.min(worst, 1 + k * foldSafeLateral(k, lat));
      }
    }
    expect(worst).toBeGreaterThan(1 - FOLD_LIMIT);
  });

  it('stays monotone and keeps the sign of the offset', () => {
    for (const k of [-K_MAX, -K_MAX / 2, -0.001, 0, 0.001, K_MAX / 2, K_MAX]) {
      let prev = -Infinity;
      for (let lat = -LAT_MAX; lat <= LAT_MAX; lat += 0.25) {
        const eff = foldSafeLateral(k, lat);
        expect(eff).toBeGreaterThan(prev);
        if (lat !== 0) expect(Math.sign(eff)).toBe(Math.sign(lat));
        expect(Math.abs(eff)).toBeLessThanOrEqual(Math.abs(lat) + 1e-12);
        prev = eff;
      }
    }
  });

  it('hands over smoothly rather than kinking at the threshold', () => {
    // C1 at the handover: the terrain grid inherits any kink here as a crease.
    const k = K_MAX;
    const h = 1e-4;
    for (let lat = -180; lat < -20; lat += 0.5) {
      const d1 = (foldSafeLateral(k, lat + h) - foldSafeLateral(k, lat - h)) / (2 * h);
      const d2 = (foldSafeLateral(k, lat + 3 * h) - foldSafeLateral(k, lat + h)) / (2 * h);
      expect(Math.abs(d2 - d1)).toBeLessThan(1e-3);
    }
  });

  it('is what pointAtEffective skips, and point applies', () => {
    // The whole point of the fast path: same answer, one curvature instead of
    // one per column. A caller that hoists must not drift from `point`.
    const path = new RoadPath(SEED);
    path.ensure(2000);
    for (const s of [12.5, 640, 1234.5, 1999]) {
      const k = path.curvature(s);
      for (const lat of [-165, -115, -48, -5.9, 0, 10, 75, 115, 165]) {
        const viaPoint = path.point(s, lat);
        const viaFast = path.pointAtEffective(s, foldSafeLateral(k, lat));
        expect(viaFast.x).toBe(viaPoint.x);
        expect(viaFast.y).toBe(viaPoint.y);
        expect(viaFast.z).toBe(viaPoint.z);
      }
    }
  });

  it('is what RoadPath.point and effectiveLateral both apply', () => {
    const path = new RoadPath(SEED);
    path.ensure(2000);
    const s = 1234.5;
    const k = path.curvature(s);
    for (const lat of [-165, -90, -12, 3, 75, 165]) {
      expect(path.effectiveLateral(s, lat)).toBe(foldSafeLateral(k, lat));
      const eff = path.effectiveLateral(s, lat);
      const centre = path.pose(s);
      const nx = -Math.cos(centre.heading);
      const nz = Math.sin(centre.heading);
      const p = path.point(s, lat);
      expect(p.x).toBeCloseTo(centre.pos.x + nx * eff, 9);
      expect(p.z).toBeCloseTo(centre.pos.z + nz * eff, 9);
    }
  });
});
