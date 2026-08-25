import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { RoadPath } from './roadPath';
import {
  ChunkManager,
  CHUNK_LEN,
  GRASS_BEHIND,
  TER_COLS,
  TERRAIN_ROW_STRIDE,
  terrainRow,
} from './chunks';
import {
  GRASS_BANDS,
  GRASS_MAX_LAT,
  GRASS_MIN_LAT,
  GRASS_RIPPLE_RATE,
  GRASS_SWAY_RATE,
  GRASS_TIERS,
  GRASS_TIME_WRAP,
  GrassField,
  lateralDensity,
  pickBand,
  ripplePhase,
  swayPhase,
  windStrength,
  wrapWindTime,
} from './grass';

const TWO_PI = Math.PI * 2;

describe('lateralDensity', () => {
  it('is zero on the road corridor and past the lateral cap', () => {
    expect(lateralDensity(0)).toBe(0);
    expect(lateralDensity(GRASS_MIN_LAT - 0.01)).toBe(0);
    expect(lateralDensity(GRASS_MAX_LAT + 0.01)).toBe(0);
    expect(lateralDensity(-3)).toBe(0);
  });

  it('is symmetric about the centerline', () => {
    for (const lat of [7, 12, 24, 40, 70]) {
      expect(lateralDensity(-lat)).toBeCloseTo(lateralDensity(lat), 12);
    }
  });

  it('falls off monotonically across the placeable band', () => {
    let prev = Infinity;
    for (let lat = GRASS_MIN_LAT; lat <= GRASS_MAX_LAT; lat += 0.5) {
      const d = lateralDensity(lat);
      expect(d).toBeLessThanOrEqual(prev + 1e-12);
      expect(d).toBeGreaterThan(0);
      prev = d;
    }
  });

  it('halves at the falloff distance', () => {
    // 1 / (1 + (lat / LAT_FALLOFF)^2) is exactly 0.5 one falloff length out.
    expect(lateralDensity(12)).toBeCloseTo(0.5, 12);
  });

  it('keeps the shoulder far denser than the far field', () => {
    // The whole point of the bias: uniform scatter over the ribbon would spend
    // most of the field on ground the chase camera never frames.
    expect(lateralDensity(8) / lateralDensity(70)).toBeGreaterThan(15);
  });
});

describe('GRASS_BANDS', () => {
  it('covers only terrain cells clear of the road and inside the cap', () => {
    expect(GRASS_BANDS.length).toBeGreaterThan(0);
    for (const band of GRASS_BANDS) {
      const l0 = TER_COLS[band.j];
      const l1 = TER_COLS[band.j + 1];
      expect(l1).toBeGreaterThan(l0);
      // Both edges on the same side of the road, outside the shoulder, inside
      // the cap — so a cluster anywhere in the cell is a legal placement.
      expect(Math.sign(l0)).toBe(Math.sign(l1));
      expect(Math.min(Math.abs(l0), Math.abs(l1))).toBeGreaterThanOrEqual(GRASS_MIN_LAT);
      expect(Math.max(Math.abs(l0), Math.abs(l1))).toBeLessThanOrEqual(GRASS_MAX_LAT);
    }
  });

  it('uses both sides of the road', () => {
    const left = GRASS_BANDS.filter((b) => TER_COLS[b.j] < 0).length;
    const right = GRASS_BANDS.length - left;
    expect(left).toBe(right);
    expect(left).toBeGreaterThan(1);
  });

  it('is a strictly increasing cumulative distribution ending at 1', () => {
    let prev = 0;
    for (const band of GRASS_BANDS) {
      expect(band.cumulative).toBeGreaterThan(prev);
      prev = band.cumulative;
    }
    expect(prev).toBeCloseTo(1, 12);
  });
});

describe('pickBand', () => {
  it('spans the whole table across a uniform roll', () => {
    expect(pickBand(0)).toBe(0);
    expect(pickBand(0.9999999)).toBe(GRASS_BANDS.length - 1);
    expect(pickBand(1)).toBe(GRASS_BANDS.length - 1);
  });

  it('reproduces the band weights over a uniform sweep', () => {
    const hits = new Array(GRASS_BANDS.length).fill(0);
    const N = 200000;
    for (let i = 0; i < N; i++) hits[pickBand((i + 0.5) / N)]++;
    let prev = 0;
    GRASS_BANDS.forEach((band, i) => {
      expect(hits[i] / N).toBeCloseTo(band.cumulative - prev, 3);
      prev = band.cumulative;
    });
  });

  it('leaves the near field denser per square metre than the far field', () => {
    const N = 200000;
    const hits = new Array(GRASS_BANDS.length).fill(0);
    for (let i = 0; i < N; i++) hits[pickBand((i + 0.5) / N)]++;
    // Both sides of the road carry the same band, so fold them together.
    const byMid = new Map<number, number>();
    GRASS_BANDS.forEach((band, i) => {
      const width = TER_COLS[band.j + 1] - TER_COLS[band.j];
      const mid = Math.abs((TER_COLS[band.j] + TER_COLS[band.j + 1]) / 2);
      byMid.set(mid, (byMid.get(mid) ?? 0) + hits[i] / width);
    });
    const perArea = [...byMid.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]);
    for (let i = 1; i < perArea.length; i++) {
      expect(perArea[i]).toBeLessThan(perArea[i - 1]);
    }
    expect(perArea[0] / perArea[perArea.length - 1]).toBeGreaterThan(10);
  });
});

describe('GRASS_TIERS', () => {
  it('meets the density target at high', () => {
    expect(GRASS_TIERS.high.clusters).toBeGreaterThanOrEqual(2000);
    expect(GRASS_TIERS.high.clusters).toBeLessThanOrEqual(3000);
  });

  it('steps down monotonically from high to low', () => {
    const order = [GRASS_TIERS.low, GRASS_TIERS.medium, GRASS_TIERS.high];
    for (let i = 1; i < order.length; i++) {
      expect(order[i].clusters).toBeGreaterThan(order[i - 1].clusters);
      expect(order[i].blades).toBeGreaterThanOrEqual(order[i - 1].blades);
      expect(order[i].segments).toBeGreaterThanOrEqual(order[i - 1].segments);
      expect(order[i].ahead).toBeGreaterThanOrEqual(order[i - 1].ahead);
    }
  });

  it('makes low genuinely cheaper, not merely thinner', () => {
    // docs/ARCHITECTURE.md §5.8: `low` is the escape hatch for weak GPUs, so
    // it has to drop work from the shader and the fragment stage too.
    expect(GRASS_TIERS.low.ripple).toBe(false);
    expect(GRASS_TIERS.low.receiveShadow).toBe(false);
    expect(GRASS_TIERS.low.segments).toBeLessThan(GRASS_TIERS.high.segments);
    expect(GRASS_TIERS.low.ahead).toBeLessThan(GRASS_TIERS.high.ahead);
  });
});

describe('wind phases', () => {
  it('keeps both sway and ripple phases in [0, 2pi)', () => {
    for (let s = 0; s < 5000; s += 13.7) {
      for (let lat = -70; lat < 70; lat += 7.3) {
        expect(swayPhase(s, lat)).toBeGreaterThanOrEqual(0);
        expect(swayPhase(s, lat)).toBeLessThan(TWO_PI);
        expect(ripplePhase(s, lat)).toBeGreaterThanOrEqual(0);
        expect(ripplePhase(s, lat)).toBeLessThan(TWO_PI);
      }
    }
  });

  it('is deterministic in (s, lat)', () => {
    expect(swayPhase(1234.5, -18.25)).toBe(swayPhase(1234.5, -18.25));
    expect(ripplePhase(1234.5, -18.25)).toBe(ripplePhase(1234.5, -18.25));
  });

  it('does not move a field in lockstep', () => {
    // Sway offsets must spread across the circle, or the whole field pulses.
    const buckets = new Array(12).fill(0);
    for (let i = 0; i < 4000; i++) {
      const s = 400 + i * 0.037;
      const lat = 6 + ((i * 0.19) % 60);
      buckets[Math.floor((swayPhase(s, lat) / TWO_PI) * 12)]++;
    }
    for (const b of buckets) expect(b).toBeGreaterThan(4000 / 12 / 3);
  });

  it('advances the gust phase along the road so it reads as travelling', () => {
    // A gust wave has to move across the field, which means the spatial phase
    // has to change with s rather than being a per-cluster constant.
    const a = ripplePhase(400, 20);
    const b = ripplePhase(405, 20);
    expect(Math.abs(a - b)).toBeGreaterThan(0.1);
  });

  it('keeps the gust phase keyed off path space, not world space', () => {
    // Floating origin (§5.2): the same (s, lat) must give the same phase
    // however far the scene has rebased, which is automatic here because the
    // function never sees a world coordinate.
    expect(ripplePhase(123456.75, 41.5)).toBe(ripplePhase(123456.75, 41.5));
  });
});

describe('wrapWindTime', () => {
  it('wraps into range', () => {
    expect(wrapWindTime(0)).toBe(0);
    expect(wrapWindTime(GRASS_TIME_WRAP * 3 + 12)).toBeCloseTo(12, 6);
    expect(wrapWindTime(-1)).toBeCloseTo(GRASS_TIME_WRAP - 1, 6);
    for (const t of [0, 1, 999, 1e5, 1e7]) {
      const w = wrapWindTime(t);
      expect(w).toBeGreaterThanOrEqual(0);
      expect(w).toBeLessThan(GRASS_TIME_WRAP);
    }
  });

  it('wraps on a period both shader terms complete a whole cycle over', () => {
    // If it did not, the wrap would jump the wind pattern once every ~1.7 h.
    for (const rate of [GRASS_SWAY_RATE, GRASS_RIPPLE_RATE]) {
      const cycles = (GRASS_TIME_WRAP * rate) / TWO_PI;
      expect(cycles).toBeCloseTo(Math.round(cycles), 9);
      for (const t of [0.25, 17, 4321.5]) {
        expect(Math.sin(rate * wrapWindTime(GRASS_TIME_WRAP + t))).toBeCloseTo(
          Math.sin(rate * (GRASS_TIME_WRAP + t)),
          6,
        );
      }
    }
  });
});

describe('windStrength', () => {
  it('is calm in clear weather and stronger in rain', () => {
    const calm = windStrength(0, 0);
    const wet = windStrength(1, 0);
    expect(calm).toBeGreaterThan(0);
    expect(wet).toBeGreaterThan(calm * 2);
  });

  it('rises monotonically through a weather crossfade', () => {
    let prev = -Infinity;
    for (let i = 0; i <= 20; i++) {
      const v = windStrength(i / 20, 0);
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
  });

  it('clamps intensities outside 0..1 rather than running away', () => {
    expect(windStrength(4, 4)).toBe(windStrength(1, 1));
    expect(windStrength(-2, -2)).toBe(windStrength(0, 0));
  });

  it('lifts the wind while leaves are drifting', () => {
    expect(windStrength(0, 1)).toBeGreaterThan(windStrength(0, 0));
  });
});

// ---------------------------------------------------------------------------

/** Every grass mesh currently hanging on a chunk group. */
function grassMeshes(cm: ChunkManager): THREE.InstancedMesh[] {
  const out: THREE.InstancedMesh[] = [];
  cm.root.traverse((o) => {
    if ((o as THREE.InstancedMesh).isInstancedMesh) out.push(o as THREE.InstancedMesh);
  });
  return out;
}

/**
 * One frame of `main.ts`'s loop, as far as ground cover is concerned: the
 * ribbon pass, then the cover pass `ChunkManager` deliberately keeps separate
 * so it can run *after* the camera has been placed (`updateCover`). Driving
 * passes no cinematic eye, which is the case every test below exercises.
 */
function frame(cm: ChunkManager, carS: number): void {
  cm.update(carS);
  cm.updateCover(carS, null);
}

/** Chunk index a grass mesh belongs to, as ChunkManager stamped it. */
function chunkIndexOf(mesh: THREE.InstancedMesh): number {
  return mesh.userData.chunkIndex as number;
}

describe('GrassField placement', () => {
  const SEED = 20260824;

  function build(quality: 'low' | 'medium' | 'high', carS: number) {
    const path = new RoadPath(SEED);
    const field = new GrassField(quality);
    const cm = new ChunkManager(path, new THREE.Scene(), field);
    frame(cm, carS);
    return { path, field, cm };
  }

  it('builds one instanced mesh per grass-bearing chunk — one draw call each', () => {
    const { cm } = build('high', 600);
    const meshes = grassMeshes(cm);
    // cur - GRASS_BEHIND .. cur + ahead, clipped to chunk 0.
    expect(meshes.length).toBe(GRASS_BEHIND + GRASS_TIERS.high.ahead + 1);
    for (const m of meshes) expect(m.count).toBe(GRASS_TIERS.high.clusters);
  });

  it('covers only the near band, not the whole AHEAD window', () => {
    const carS = 600;
    const cur = Math.floor(carS / CHUNK_LEN);
    const { cm } = build('high', carS);
    // The manager holds 26 chunks; only a handful of them may carry grass.
    expect(cm.root.children.length).toBeGreaterThan(20);
    const withGrass = cm.root.children.filter((g) =>
      g.children.some((c) => (c as THREE.InstancedMesh).isInstancedMesh),
    );
    expect(withGrass.length).toBeLessThanOrEqual(GRASS_BEHIND + GRASS_TIERS.high.ahead + 1);
    for (const mesh of grassMeshes(cm)) {
      const idx = chunkIndexOf(mesh);
      expect(idx).toBeGreaterThanOrEqual(cur - GRASS_BEHIND);
      expect(idx).toBeLessThanOrEqual(cur + GRASS_TIERS.high.ahead);
      // Nothing is built beyond the far edge of the last band chunk.
      expect((idx + 1) * CHUNK_LEN - carS).toBeLessThanOrEqual(
        (GRASS_TIERS.high.ahead + 1) * CHUNK_LEN,
      );
    }
  });

  it('clips the band at the start of the road rather than building chunk -1', () => {
    const { cm } = build('high', 10);
    expect(grassMeshes(cm).length).toBe(GRASS_TIERS.high.ahead + 1);
  });

  it('adds and removes grass as the car advances, keeping the band bounded', () => {
    const { cm } = build('medium', 600);
    const expected = GRASS_BEHIND + GRASS_TIERS.medium.ahead + 1;
    for (let i = 1; i <= 12; i++) {
      frame(cm, 600 + i * CHUNK_LEN);
      expect(grassMeshes(cm).length).toBe(expected);
    }
  });

  it('rebuilds the band when the quality tier changes', () => {
    const { cm, field } = build('low', 600);
    expect(grassMeshes(cm)[0].count).toBe(GRASS_TIERS.low.clusters);
    field.setQuality('high');
    frame(cm, 600);
    const meshes = grassMeshes(cm);
    expect(meshes.length).toBe(GRASS_BEHIND + GRASS_TIERS.high.ahead + 1);
    for (const m of meshes) expect(m.count).toBe(GRASS_TIERS.high.clusters);
  });

  /**
   * The rebuild trigger is a revision number compared per chunk per frame, so
   * the failure mode is silent and expensive: a comparison that never matches
   * drops and rebuilds every band chunk on *every* `update()` — several
   * thousand-cluster `InstancedMesh` builds a frame — with nothing else
   * visibly wrong. Counted here rather than inferred from the meshes, because
   * a rebuilt band and an untouched one look identical.
   */
  it('rebuilds the band once per quality change and never in a steady frame', () => {
    const { cm, field } = build('low', 600);
    const builds = vi.spyOn(field, 'build');

    // Same car, same quality: nothing to do at all.
    for (let f = 0; f < 5; f++) frame(cm, 600);
    expect(builds).not.toHaveBeenCalled();

    // A quality change rebuilds each band chunk exactly once, not once a frame.
    field.setQuality('high');
    frame(cm, 600);
    // The four chunks the low band held, plus the one the wider high band adds.
    expect(builds).toHaveBeenCalledTimes(GRASS_BEHIND + GRASS_TIERS.high.ahead + 1);
    builds.mockClear();
    for (let f = 0; f < 5; f++) frame(cm, 600);
    expect(builds).not.toHaveBeenCalled();

    builds.mockRestore();
  });

  it('regenerates a stretch of road identically', () => {
    const a = build('medium', 600);
    const b = build('medium', 600);
    const ma = grassMeshes(a.cm);
    const mb = grassMeshes(b.cm);
    expect(ma.length).toBe(mb.length);
    for (let i = 0; i < ma.length; i++) {
      expect(Array.from(ma[i].instanceMatrix.array)).toEqual(
        Array.from(mb[i].instanceMatrix.array),
      );
    }
  });

  it('never casts shadows', () => {
    const { cm } = build('high', 600);
    for (const m of grassMeshes(cm)) expect(m.castShadow).toBe(false);
  });

  it('releases per-chunk geometry when a chunk leaves the band', () => {
    const { cm } = build('medium', 600);
    const leaving = grassMeshes(cm)[0];
    let disposed = false;
    leaving.geometry.addEventListener('dispose', () => {
      disposed = true;
    });
    for (let i = 1; i <= 4; i++) frame(cm, 600 + i * CHUNK_LEN);
    expect(disposed).toBe(true);
    expect(leaving.parent).toBe(null);
  });

  it('releases everything on reset', () => {
    const { cm } = build('high', 600);
    expect(grassMeshes(cm).length).toBeGreaterThan(0);
    cm.reset();
    expect(grassMeshes(cm).length).toBe(0);
  });
});

describe('GrassField grounding', () => {
  const SEED = 20260824;
  /** Sink applied to every cluster so the blade roots hide in the surface. */
  const SINK = 0.04;

  /**
   * Rebuild a chunk's terrain grid independently and find the drawn triangle
   * under a world XZ point, returning its height. Mirrors the terrain index
   * buffer's a,b,c / b,d,c split — the same one `grass.ts` interpolates over,
   * so a cluster that missed its triangle shows up as a height that is not on
   * the drawn surface at all (the "floating trees" bug, §5.3).
   */
  function drawnHeightAt(path: RoadPath, index: number, x: number, z: number): number | null {
    const cols = TER_COLS.length;
    const rows = CHUNK_LEN / 6 + 1;
    const grid = new Float64Array(rows * cols * TERRAIN_ROW_STRIDE);
    for (let r = 0; r < rows; r++) {
      terrainRow(path, index * CHUNK_LEN + r * 6, grid, r * cols * TERRAIN_ROW_STRIDE);
    }
    const at = (r: number, c: number) => {
      const o = (r * cols + c) * TERRAIN_ROW_STRIDE;
      return { x: grid[o], y: grid[o + 1], z: grid[o + 2] };
    };
    let best: number | null = null;
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = at(r, c);
        const b = at(r, c + 1);
        const cc = at(r + 1, c);
        const d = at(r + 1, c + 1);
        for (const tri of [
          [a, b, cc],
          [b, d, cc],
        ]) {
          const [A, B, C] = tri;
          const e0x = B.x - A.x;
          const e0z = B.z - A.z;
          const e1x = C.x - A.x;
          const e1z = C.z - A.z;
          const den = e0x * e1z - e1x * e0z;
          if (Math.abs(den) < 1e-12) continue;
          const dx = x - A.x;
          const dz = z - A.z;
          const w1 = (dx * e1z - e1x * dz) / den;
          const w2 = (e0x * dz - dx * e0z) / den;
          const w0 = 1 - w1 - w2;
          if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
          best = w0 * A.y + w1 * B.y + w2 * C.y;
        }
      }
    }
    return best;
  }

  it('stands every cluster on the terrain triangle the renderer draws', () => {
    const path = new RoadPath(SEED);
    const cm = new ChunkManager(path, new THREE.Scene(), new GrassField('low'));
    const carS = 600;
    frame(cm, carS);
    const meshes = grassMeshes(cm);
    expect(meshes.length).toBeGreaterThan(0);

    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    let checked = 0;
    let misses = 0;
    for (const mesh of meshes) {
      const group = mesh.parent as THREE.Group;
      const index = chunkIndexOf(mesh);
      for (let i = 0; i < mesh.count; i += 7) {
        mesh.getMatrixAt(i, m);
        m.decompose(pos, quat, scale);
        const wx = pos.x + group.position.x;
        const wz = pos.z + group.position.z;
        const surface = drawnHeightAt(path, index, wx, wz);
        if (surface === null) {
          misses++;
          continue;
        }
        // The cluster origin is the surface, sunk by a constant. Four places
        // is the float32 instance matrix's own resolution at these heights —
        // the bug this guards against was measured in metres (§5.3).
        expect(pos.y + SINK).toBeCloseTo(surface, 4);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(200);
    // Every cluster is *constructed* inside a cell, so none may fall outside
    // the meshed grid it was built from.
    expect(misses).toBe(0);
  });

  it('keeps clusters off the road and inside the lateral cap', () => {
    const path = new RoadPath(SEED);
    const cm = new ChunkManager(path, new THREE.Scene(), new GrassField('low'));
    frame(cm, 600);
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const roadP = new THREE.Vector3();
    for (const mesh of grassMeshes(cm)) {
      const group = mesh.parent as THREE.Group;
      for (let i = 0; i < mesh.count; i += 11) {
        mesh.getMatrixAt(i, m);
        m.decompose(pos, quat, scale);
        const wx = pos.x + group.position.x;
        const wz = pos.z + group.position.z;
        // Nearest approach to the centerline over the chunk's span.
        let near = Infinity;
        for (let s = 540; s <= 960; s += 2) {
          path.point(s, 0, roadP);
          near = Math.min(near, Math.hypot(roadP.x - wx, roadP.z - wz));
        }
        expect(near).toBeGreaterThan(GRASS_MIN_LAT - 0.5);
        expect(near).toBeLessThan(GRASS_MAX_LAT + 1);
      }
    }
  });
});

describe('GrassField.tick', () => {
  it('advances the clock without letting it run away', () => {
    const field = new GrassField('high');
    for (let i = 0; i < 200; i++) field.tick(1 / 60, 0.1);
    // Nothing to read directly — the guarantee is that a long session cannot
    // push the shader clock out of range, which wrapWindTime enforces.
    for (let i = 0; i < 100; i++) field.tick(120, 0.1);
    expect(wrapWindTime(GRASS_TIME_WRAP * 1e4 + 3)).toBeCloseTo(3, 5);
    field.dispose();
  });
});
