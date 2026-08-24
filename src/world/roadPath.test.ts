import { describe, it, expect } from 'vitest';
import { RoadPath } from './roadPath';

const SEED = 20260824;

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
