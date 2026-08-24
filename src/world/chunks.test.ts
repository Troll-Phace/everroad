import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { RoadPath } from './roadPath';
import {
  CHUNK_LEN,
  ChunkManager,
  SLOPE_FOLLOW,
  TER_COLS,
  TER_ROW_STEP,
  createTerrainSample,
  groundProp,
  propOrientation,
  sampleTerrainMesh,
  terrainHeight,
  terrainMeshHeight,
} from './chunks';

/**
 * The tests below rebuild the terrain mesh independently of chunks.ts and
 * compare against it, so a wrong cell lookup or a flipped triangle split shows
 * up as a height that no longer lies on the drawn surface.
 */

interface Corner {
  x: number;
  y: number;
  z: number;
}

function corner(path: RoadPath, s: number, lat: number): Corner {
  const p = path.point(s, lat, new THREE.Vector3());
  return { x: p.x, y: terrainHeight(path, s, lat), z: p.z };
}

/** The four corners of the mesh cell containing (s, lat): a, b, c, d. */
function cell(path: RoadPath, s: number, lat: number): [Corner, Corner, Corner, Corner] {
  const s0 = Math.floor(s / TER_ROW_STEP) * TER_ROW_STEP;
  let j = 0;
  while (j < TER_COLS.length - 2 && lat > TER_COLS[j + 1]) j++;
  const l0 = TER_COLS[j];
  const l1 = TER_COLS[j + 1];
  return [
    corner(path, s0, l0),
    corner(path, s0, l1),
    corner(path, s0 + TER_ROW_STEP, l0),
    corner(path, s0 + TER_ROW_STEP, l1),
  ];
}

/** Height of the plane through three corners, at the XZ of (px, pz). */
function planeHeight(A: Corner, B: Corner, C: Corner, px: number, pz: number): number {
  const e0x = B.x - A.x;
  const e0z = B.z - A.z;
  const e1x = C.x - A.x;
  const e1z = C.z - A.z;
  const den = e0x * e1z - e1x * e0z;
  const dx = px - A.x;
  const dz = pz - A.z;
  const w1 = (dx * e1z - e1x * dz) / den;
  const w2 = (e0x * dz - dx * e0z) / den;
  return (1 - w1 - w2) * A.y + w1 * B.y + w2 * C.y;
}

/** The drawn surface height at (s, lat), found without consulting chunks.ts. */
function drawnHeight(path: RoadPath, s: number, lat: number): number {
  const [a, b, c, d] = cell(path, s, lat);
  const p = path.point(s, lat, new THREE.Vector3());
  // Whichever of the cell's two triangles actually covers the point in XZ.
  const inside = (A: Corner, B: Corner, C: Corner): boolean => {
    const sign = (P: Corner | { x: number; z: number }, Q: Corner, R: Corner): number =>
      (P.x - R.x) * (Q.z - R.z) - (Q.x - R.x) * (P.z - R.z);
    const d1 = sign(p, A, B);
    const d2 = sign(p, B, C);
    const d3 = sign(p, C, A);
    const neg = d1 < -1e-9 || d2 < -1e-9 || d3 < -1e-9;
    const pos = d1 > 1e-9 || d2 > 1e-9 || d3 > 1e-9;
    return !(neg && pos);
  };
  if (inside(a, b, c)) return planeHeight(a, b, c, p.x, p.z);
  return planeHeight(b, d, c, p.x, p.z);
}

function newPath(): RoadPath {
  const path = new RoadPath(1337);
  path.ensure(4000);
  return path;
}

describe('sampleTerrainMesh', () => {
  it('returns the mesh vertex height exactly at grid corners', () => {
    const path = newPath();
    for (let s = 0; s <= 600; s += TER_ROW_STEP) {
      for (const lat of TER_COLS) {
        expect(terrainMeshHeight(path, s, lat)).toBeCloseTo(terrainHeight(path, s, lat), 9);
      }
    }
  });

  it('lies on the drawn triangle everywhere inside a cell', () => {
    const path = newPath();
    // Deterministic sweep of interior points across many cells and columns.
    for (let s = 3; s < 900; s += 1.37) {
      for (let j = 0; j < TER_COLS.length - 1; j++) {
        for (const f of [0.13, 0.5, 0.87]) {
          const lat = TER_COLS[j] + (TER_COLS[j + 1] - TER_COLS[j]) * f;
          expect(terrainMeshHeight(path, s, lat)).toBeCloseTo(drawnHeight(path, s, lat), 6);
        }
      }
    }
  });

  it('splits each cell on the diagonal the terrain index buffer draws', () => {
    const path = newPath();
    // gridIndices emits (a,b,c) then (b,d,c). A point at u+v < 1 belongs to
    // the first triangle, one at u+v > 1 to the second, and on a sloped cell
    // the two planes disagree — so sampling the other diagonal is visible.
    const s0 = 2022;
    const j = 1; // -115 .. -75: a wide field column where the split really bites
    const l0 = TER_COLS[j];
    const l1 = TER_COLS[j + 1];
    const [a, b, c, d] = cell(path, s0 + 1, l0 + 1);

    const lowSide = { s: s0 + TER_ROW_STEP * 0.2, lat: l0 + (l1 - l0) * 0.2 };
    const highSide = { s: s0 + TER_ROW_STEP * 0.8, lat: l0 + (l1 - l0) * 0.8 };

    for (const [pt, tri, other] of [
      [lowSide, [a, b, c], [b, d, c]],
      [highSide, [b, d, c], [a, b, c]],
    ] as [{ s: number; lat: number }, Corner[], Corner[]][]) {
      const p = path.point(pt.s, pt.lat, new THREE.Vector3());
      const mine = planeHeight(tri[0], tri[1], tri[2], p.x, p.z);
      const wrong = planeHeight(other[0], other[1], other[2], p.x, p.z);
      expect(terrainMeshHeight(path, pt.s, pt.lat)).toBeCloseTo(mine, 6);
      // The fixture is only meaningful if the two triangles actually differ.
      expect(Math.abs(mine - wrong)).toBeGreaterThan(0.05);
      // ...and the wrong diagonal is exactly what a mis-split would return.
      expect(terrainMeshHeight(path, pt.s, pt.lat)).not.toBeCloseTo(wrong, 2);
    }
  });

  it('reads the cell the point falls in, not a neighbouring one', () => {
    const path = newPath();
    const s = 246 + TER_ROW_STEP * 0.75;
    const lat = -60; // inside the -75 .. -48 column
    const here = terrainMeshHeight(path, s, lat);
    expect(here).toBeCloseTo(drawnHeight(path, s, lat), 6);

    // The next row and the next column both carry a different surface.
    const nextRow = drawnHeight(path, s + TER_ROW_STEP, lat);
    const nextCol = drawnHeight(path, s, -40);
    expect(Math.abs(here - nextRow)).toBeGreaterThan(0.05);
    expect(Math.abs(here - nextCol)).toBeGreaterThan(0.05);
  });

  it('stays continuous across row and column boundaries', () => {
    const path = newPath();
    const eps = 1e-4;
    for (const s of [120, 306, 612]) {
      for (const lat of [-75, -30, 10, 48, 115]) {
        const acrossRow = Math.abs(
          terrainMeshHeight(path, s - eps, lat) - terrainMeshHeight(path, s + eps, lat),
        );
        const acrossCol = Math.abs(
          terrainMeshHeight(path, s + 2, lat - eps) - terrainMeshHeight(path, s + 2, lat + eps),
        );
        // Adjacent cells share the edge, so the seam is smooth: what is left is
        // the slope across 2e-4 m, not a step.
        expect(acrossRow).toBeLessThan(0.005);
        expect(acrossCol).toBeLessThan(0.005);
      }
    }
  });

  it('clamps to the meshed span outside the terrain ribbon', () => {
    const path = newPath();
    const s = 402.5;
    expect(terrainMeshHeight(path, s, -900)).toBe(terrainMeshHeight(path, s, TER_COLS[0]));
    expect(terrainMeshHeight(path, s, 900)).toBe(
      terrainMeshHeight(path, s, TER_COLS[TER_COLS.length - 1]),
    );
  });

  it('departs from the analytic height field by metres mid-cell', () => {
    // The bug this exists to fix: grounding to terrainHeight puts props on a
    // surface that is not the one being drawn.
    const path = newPath();
    let worst = 0;
    for (let s = 5; s < 1500; s += 3.1) {
      for (const lat of [-142, -90, 60, 130]) {
        worst = Math.max(
          worst,
          Math.abs(terrainHeight(path, s, lat) - terrainMeshHeight(path, s, lat)),
        );
      }
    }
    expect(worst).toBeGreaterThan(1);
  });

  it('reports a unit, upward face normal that matches the sampled triangle', () => {
    const path = newPath();
    const out = createTerrainSample();
    for (let row = 2; row < 60; row += 7) {
      for (let j = 0; j < TER_COLS.length - 1; j++) {
        // Well inside the cell's first triangle, and a step that stays in it.
        const s = row * TER_ROW_STEP + TER_ROW_STEP * 0.25;
        const lat = TER_COLS[j] + (TER_COLS[j + 1] - TER_COLS[j]) * 0.25;
        const s2 = s + TER_ROW_STEP * 0.1;
        sampleTerrainMesh(path, s, lat, out);
        expect(out.normal.length()).toBeCloseTo(1, 9);
        expect(out.normal.y).toBeGreaterThan(0);
        // The normal must describe the surface the height came from: the plane
        // it defines predicts a neighbouring sample on the same triangle.
        const gradX = -out.normal.x / out.normal.y;
        const gradZ = -out.normal.z / out.normal.y;
        const p0 = path.point(s, lat, new THREE.Vector3());
        const p1 = path.point(s2, lat, new THREE.Vector3());
        const predicted = out.y + gradX * (p1.x - p0.x) + gradZ * (p1.z - p0.z);
        expect(terrainMeshHeight(path, s2, lat)).toBeCloseTo(predicted, 6);
      }
    }
  });

  it('never returns NaN, including on the folded far-field cells', () => {
    const path = newPath();
    const out = createTerrainSample();
    for (let s = 0; s < 3000; s += 7.3) {
      for (const lat of [-165, -164.99, -158, 158, 164.99, 165]) {
        sampleTerrainMesh(path, s, lat, out);
        expect(Number.isFinite(out.y)).toBe(true);
        expect(Number.isFinite(out.normal.x + out.normal.y + out.normal.z)).toBe(true);
      }
    }
  });
});

describe('propOrientation', () => {
  const up = new THREE.Vector3(0, 1, 0);
  /** Angle, in radians, between the prop's local up and world up. */
  const leanOf = (q: THREE.Quaternion): number =>
    up
      .clone()
      .applyQuaternion(q)
      .angleTo(new THREE.Vector3(0, 1, 0));

  const slope = (deg: number): THREE.Vector3 =>
    new THREE.Vector3(Math.sin((deg * Math.PI) / 180), Math.cos((deg * Math.PI) / 180), 0);

  it('leaves a prop on flat ground with yaw only', () => {
    const q = propOrientation(1.2, new THREE.Vector3(0, 1, 0), 1, new THREE.Quaternion());
    const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
    expect(e.x).toBeCloseTo(0, 9);
    expect(e.z).toBeCloseTo(0, 9);
    expect(e.y).toBeCloseTo(1.2, 9);
  });

  it('lays a fully-following prop flush with the face', () => {
    const n = slope(18);
    const q = propOrientation(0.4, n, 1, new THREE.Quaternion());
    const local = up.clone().applyQuaternion(q);
    expect(local.angleTo(n)).toBeCloseTo(0, 6);
  });

  it('keeps trees essentially upright on the same face', () => {
    const n = slope(24);
    const tree = propOrientation(0, n, SLOPE_FOLLOW.oak, new THREE.Quaternion());
    const tuft = propOrientation(0, n, SLOPE_FOLLOW.grassTuft, new THREE.Quaternion());
    expect(leanOf(tree)).toBeLessThan((6 * Math.PI) / 180);
    expect(leanOf(tuft)).toBeCloseTo((24 * Math.PI) / 180, 6);
    expect(SLOPE_FOLLOW.windmill).toBeLessThanOrEqual(SLOPE_FOLLOW.oak);
  });

  it('scales the lean by the follow factor', () => {
    const n = slope(20);
    const half = propOrientation(0, n, 0.5, new THREE.Quaternion());
    expect(leanOf(half)).toBeCloseTo((10 * Math.PI) / 180, 6);
  });

  it('caps the lean so nothing lies down on a folded face', () => {
    for (const deg of [40, 70, 89]) {
      const q = propOrientation(0, slope(deg), 1, new THREE.Quaternion());
      expect(leanOf(q)).toBeLessThanOrEqual(0.5 + 1e-9);
    }
  });
});

describe('groundProp', () => {
  /** A spot where the drawn surface and the height field are metres apart. */
  const FAR = { s: 1554, lat: 142.7 };

  it('settles props onto the drawn terrain, not the height field', () => {
    const path = newPath();
    const drawn = terrainMeshHeight(path, FAR.s, FAR.lat);
    const field = terrainHeight(path, FAR.s, FAR.lat);
    expect(Math.abs(drawn - field)).toBeGreaterThan(1);

    for (const kind of ['grassTuft', 'flowers', 'rock', 'oak', 'windmill'] as const) {
      const y = groundProp(path, FAR.s, FAR.lat, kind, 0.3, new THREE.Quaternion());
      expect(Math.abs(y - drawn)).toBeLessThan(0.2);
      expect(Math.abs(y - field)).toBeGreaterThan(1);
    }
  });

  it('sinks the base a few centimetres, more for props kept upright', () => {
    const path = newPath();
    const drawn = terrainMeshHeight(path, FAR.s, FAR.lat);
    const tuft = drawn - groundProp(path, FAR.s, FAR.lat, 'grassTuft', 0, new THREE.Quaternion());
    const oak = drawn - groundProp(path, FAR.s, FAR.lat, 'oak', 0, new THREE.Quaternion());
    expect(tuft).toBeGreaterThan(0);
    expect(tuft).toBeLessThan(0.05);
    // An upright trunk on a slope has to bury its base deeper than a tuft that
    // lies flush with the face.
    expect(oak).toBeGreaterThan(tuft);
    expect(oak).toBeLessThan(0.2);
  });

  it('orients the prop to the face it was grounded to', () => {
    const path = newPath();
    const sample = createTerrainSample();
    const q = new THREE.Quaternion();
    for (const kind of ['grassTuft', 'oak'] as const) {
      groundProp(path, FAR.s, FAR.lat, kind, 0.75, q);
      sampleTerrainMesh(path, FAR.s, FAR.lat, sample);
      const expected = propOrientation(
        0.75,
        sample.normal,
        SLOPE_FOLLOW[kind],
        new THREE.Quaternion(),
      );
      expect(q.angleTo(expected)).toBeCloseTo(0, 6);
    }
  });
});

describe('ChunkManager world layout', () => {
  /**
   * Captured from the generator before scenery was regrounded. Placement is
   * seeded from the chunk index, so any change to the order the seeded stream
   * is consumed reshuffles every existing stretch of world.
   */
  const GOLDEN_OBSTACLES: Record<number, [string, number, number, number][]> = {
    0: [['0:33', 54.861556, -7.449082, 2.627759]],
    1: [['1:5', 111.552899, -9.019832, 2.76586]],
    2: [['2:28', 165.422818, 8.539785, 2.862099]],
    3: [['3:19', 236.139531, 7.713337, 2.453197]],
    4: [],
    5: [],
    6: [],
  };
  const GOLDEN_VERTS = [17976, 20040, 20868, 25236, 25848, 26616, 28572];

  function build(): ChunkManager {
    const cm = new ChunkManager(new RoadPath(1337), new THREE.Scene());
    cm.update(0);
    return cm;
  }

  function obstaclesOf(cm: ChunkManager, index: number) {
    return [...cm.obstaclesNear(index * 60 + 30, 30)].filter((o) => Math.floor(o.s / 60) === index);
  }

  it('places the same props in the same s/lat as before regrounding', () => {
    const cm = build();
    for (const [key, expected] of Object.entries(GOLDEN_OBSTACLES)) {
      const got = obstaclesOf(cm, Number(key));
      expect(got.map((o) => o.key)).toEqual(expected.map((e) => e[0]));
      got.forEach((o, i) => {
        expect(o.s).toBeCloseTo(expected[i][1], 5);
        expect(o.lateral).toBeCloseTo(expected[i][2], 5);
        expect(o.radius).toBeCloseTo(expected[i][3], 5);
      });
    }
  });

  it('bakes the same scenery kinds in the same order', () => {
    const cm = build();
    GOLDEN_VERTS.forEach((count, i) => {
      const group = cm.root.children[i] as THREE.Group;
      const scenery = group.children.find(
        (c) => (c as THREE.Mesh).geometry && !(c as THREE.Mesh).geometry.index,
      ) as THREE.Mesh;
      expect(scenery.geometry.attributes.position.count).toBe(count);
    });
  });

  it('regenerates a stretch of road identically', () => {
    const a = obstaclesOf(build(), 2);
    const b = obstaclesOf(build(), 2);
    expect(a).toEqual(b);
  });
});

describe('sampleTerrainMesh vs. the rendered geometry', () => {
  /**
   * Everything above compares `sampleTerrainMesh` against a reference built in
   * this file, and that reference shares its shape with the implementation: the
   * same barycentric solve, the same cell walk. A sign error or an off-by-one
   * column would be mirrored by the reference and stay invisible. This test
   * has no such shape. It reads the `BufferGeometry` the ChunkManager actually
   * hands three.js, walks its index buffer triangle by triangle with no idea
   * which cell a point "should" be in, and asks what the drawn surface is under
   * that XZ. If the sampler ever walks a different grid than the mesh builder,
   * this is what catches it.
   */
  const CHUNK = 3;
  const TER_ROWS = CHUNK_LEN / TER_ROW_STEP + 1;

  /** The chunk's terrain mesh and the world offset its vertices are stored against. */
  function terrainOf(cm: ChunkManager, index: number): { mesh: THREE.Mesh; origin: THREE.Vector3 } {
    const group = cm.root.children[index] as THREE.Group;
    // Road and terrain are both indexed grids; only terrain is TER_COLS wide.
    const mesh = group.children.find((c) => {
      const g = (c as THREE.Mesh).geometry;
      return !!g && !!g.index && g.attributes.position.count === TER_ROWS * TER_COLS.length;
    }) as THREE.Mesh | undefined;
    expect(mesh, 'chunk has a terrain mesh').toBeDefined();
    return { mesh: mesh as THREE.Mesh, origin: group.position };
  }

  /**
   * Height of the drawn surface at world (px, pz), read off the geometry alone.
   * Every triangle in the index buffer is tested; where the far-field cells
   * fold over each other and several cover the point, the highest one wins —
   * that is the surface a prop would stand on. Null when nothing covers it.
   */
  function renderedHeight(
    mesh: THREE.Mesh,
    origin: THREE.Vector3,
    px: number,
    pz: number,
  ): number | null {
    const pos = mesh.geometry.attributes.position as THREE.BufferAttribute;
    const idx = mesh.geometry.index as THREE.BufferAttribute;
    let best: number | null = null;
    for (let t = 0; t < idx.count; t += 3) {
      const i0 = idx.getX(t);
      const i1 = idx.getX(t + 1);
      const i2 = idx.getX(t + 2);
      const ax = pos.getX(i0) + origin.x;
      const az = pos.getZ(i0) + origin.z;
      const e0x = pos.getX(i1) + origin.x - ax;
      const e0z = pos.getZ(i1) + origin.z - az;
      const e1x = pos.getX(i2) + origin.x - ax;
      const e1z = pos.getZ(i2) + origin.z - az;
      const den = e0x * e1z - e1x * e0z;
      if (Math.abs(den) < 1e-9) continue;
      const dx = px - ax;
      const dz = pz - az;
      const w1 = (dx * e1z - e1x * dz) / den;
      const w2 = (e0x * dz - dx * e0z) / den;
      const w0 = 1 - w1 - w2;
      if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
      const y = w0 * pos.getY(i0) + w1 * pos.getY(i1) + w2 * pos.getY(i2);
      if (best === null || y > best) best = y;
    }
    return best;
  }

  it('returns the height of the triangle the renderer draws, in every column band', () => {
    const path = new RoadPath(1337);
    const cm = new ChunkManager(path, new THREE.Scene());
    cm.update(0);
    const { mesh, origin } = terrainOf(cm, CHUNK);
    const p = new THREE.Vector3();
    let worst = 0;
    let worstAt = '';
    let covered = 0;
    let samples = 0;
    let uncoveredWorstLat = 0;
    // Every row of the chunk, every lateral band, both sides of the diagonal.
    for (let row = 0; row < CHUNK_LEN / TER_ROW_STEP; row++) {
      for (let j = 0; j < TER_COLS.length - 1; j++) {
        for (const [fu, fv] of [
          [0.21, 0.17],
          [0.5, 0.5],
          [0.76, 0.83],
          [0.13, 0.88],
          [0.88, 0.13],
        ]) {
          const s = CHUNK * CHUNK_LEN + (row + fu) * TER_ROW_STEP;
          const lat = TER_COLS[j] + (TER_COLS[j + 1] - TER_COLS[j]) * fv;
          samples++;
          path.point(s, lat, p);
          const drawn = renderedHeight(mesh, origin, p.x, p.z);
          if (drawn === null) {
            uncoveredWorstLat = Math.max(uncoveredWorstLat, Math.abs(lat));
            continue;
          }
          covered++;
          const err = Math.abs(drawn - terrainMeshHeight(path, s, lat));
          if (err > worst) {
            worst = err;
            worstAt = `s=${s} lat=${lat}`;
          }
        }
      }
    }
    // Fixture validity: none of chunk 3's cells fold over themselves in XZ, so
    // every sample must land inside a drawn triangle. If a retune ever makes
    // one fold, move the fixture chunk — do not loosen this.
    expect(covered, `uncovered sample out to |lat| ${uncoveredWorstLat}`).toBe(samples);
    // 0.1 mm. The floor is the geometry's own Float32 storage (measured worst
    // case ~1.2e-6 m); the thing this catches — a wrong cell, a wrong diagonal,
    // a flipped sign — is wrong by metres, so there is no middle ground here.
    expect(worst, `worst disagreement at ${worstAt}`).toBeLessThan(1e-4);
  });
});
