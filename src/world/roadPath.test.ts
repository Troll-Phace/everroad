import { describe, it, expect } from 'vitest';
import { DS, RoadPath } from './roadPath';

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
