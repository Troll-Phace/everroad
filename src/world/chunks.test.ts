import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { RoadPath } from './roadPath';
import {
  CHUNK_LEN,
  ChunkManager,
  GRASS_BEHIND,
  MENU_BEHIND,
  PLAY_BEHIND,
  SLOPE_FOLLOW,
  TER_COLS,
  TER_ROW_STEP,
  TERRAIN_ROW_STRIDE,
  coverBand,
  createTerrainSample,
  groundProp,
  terrainRow,
  propOrientation,
  sampleTerrainMesh,
  terrainHeight,
  terrainMeshHeight,
  type CoverBand,
  type CoverEye,
} from './chunks';
import { GRASS_TIERS, GrassField } from './grass';
import {
  MENU_MAX_LEAD,
  MENU_SHOTS,
  MenuCamera,
  type CinematicTarget,
  type MenuShotId,
} from './menuCamera';
import { CARS } from '../game/economy/cars';

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
   * Captured from the generator. Placement is seeded from the chunk index, so
   * any change to the order the seeded stream is consumed reshuffles every
   * existing stretch of world — the clumping pass in `buildScenery` did, which
   * is why these were re-taken. Obstacles now arrive in runs because near-road
   * rocks and fences are placed in clumps rather than one at a time.
   */
  const GOLDEN_OBSTACLES: Record<number, [string, number, number, number][]> = {
    0: [
      ['0:44', 32.543384, -8.403857, 2.707512],
      ['0:45', 32.123695, -7.876293, 2.111137],
      ['0:55', 12.93698, 9.441718, 1.742635],
      ['0:56', 10.395281, 9.446043, 2.442634],
    ],
    1: [],
    2: [
      ['2:54', 168.864785, 9.276291, 1.962876],
      ['2:55', 171.25262, 9.899184, 2.67398],
    ],
    3: [],
    4: [],
    5: [],
    6: [],
  };
  const GOLDEN_VERTS = [32244, 33192, 23772, 26736, 29376, 29820, 32136];

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

describe('ChunkManager.setBehind', () => {
  /** How many chunks the manager is holding, whatever their indices. */
  function live(cm: ChunkManager): number {
    return cm.root.children.length;
  }

  function at(behind: number, carS: number): ChunkManager {
    const cm = new ChunkManager(new RoadPath(1337), new THREE.Scene());
    cm.setBehind(behind);
    cm.update(carS);
    return cm;
  }

  it('drives how far the ribbon reaches back from the car', () => {
    const carS = 40 * CHUNK_LEN;
    const grew = live(at(MENU_BEHIND, carS)) - live(at(PLAY_BEHIND, carS));
    expect(grew).toBe(MENU_BEHIND - PLAY_BEHIND);
    expect(at(MENU_BEHIND, carS).behind).toBe(MENU_BEHIND);
  });

  /**
   * Attract mode grows the tail and gameplay hands it straight back, so the
   * shrink has to recycle rather than leave the extra chunks stranded in the
   * scene graph paying for themselves every frame.
   */
  it('recycles the extra chunks when the tail is handed back', () => {
    const carS = 40 * CHUNK_LEN;
    const cm = at(MENU_BEHIND, carS);
    cm.setBehind(PLAY_BEHIND);
    cm.update(carS);
    expect(live(cm)).toBe(live(at(PLAY_BEHIND, carS)));
  });

  /** Driving is the floor: nothing may shorten the tail under it. */
  it('never goes under the driving tail', () => {
    const cm = new ChunkManager(new RoadPath(1337), new THREE.Scene());
    cm.setBehind(0);
    expect(cm.behind).toBe(PLAY_BEHIND);
    cm.setBehind(-5);
    expect(cm.behind).toBe(PLAY_BEHIND);
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

describe('terrain ribbon folding', () => {
  /**
   * The shipping seed — the fold is a property of a specific road, and the
   * tight bends quoted in #36/#39 are that road's. `1 / |curvature(s)|` is
   * exact, so check it before calling any stretch tight: s ~ 24.6 km has twice
   * been mistaken for a bend here and is a 1928 m near-straight.
   */
  const SHIPPING_SEED = 20260824;
  /** The tightest bends in the first 432 km: R 92.4, 91.3, 88.7 m. */
  const TIGHT = [21123, 99129, 431619];

  /** XZ cross product of a cell triangle, in the winding gridIndices emits. */
  function windingOf(path: RoadPath, s: number, l0: number, l1: number): [number, number] {
    const pt = (ss: number, ll: number) => path.point(ss, ll, new THREE.Vector3());
    const a = pt(s, l0);
    const b = pt(s, l1);
    const c = pt(s + TER_ROW_STEP, l0);
    const d = pt(s + TER_ROW_STEP, l1);
    const cross = (P: THREE.Vector3, Q: THREE.Vector3, R: THREE.Vector3) =>
      (Q.x - P.x) * (R.z - P.z) - (R.x - P.x) * (Q.z - P.z);
    return [cross(a, b, c), cross(b, d, c)];
  }

  it('winds every cell the same way at the tightest bends the generator makes', () => {
    const path = new RoadPath(SHIPPING_SEED);
    for (const S of TIGHT) {
      path.ensure(S + 400);
      const R = 1 / Math.abs(path.curvature(S));
      expect(R, `s=${S} is not actually a tight bend`).toBeLessThan(95);
      for (let s = S - 120; s <= S + 120; s += TER_ROW_STEP) {
        for (let j = 0; j < TER_COLS.length - 1; j++) {
          const [t1, t2] = windingOf(path, s, TER_COLS[j], TER_COLS[j + 1]);
          // Both triangles wind negative on an un-inverted cell; a fold flips
          // the sign, which is what crumpled the far field.
          expect(t1, `folded cell at s=${s} lat=${TER_COLS[j]}`).toBeLessThan(0);
          expect(t2, `folded cell at s=${s} lat=${TER_COLS[j]}`).toBeLessThan(0);
        }
      }
    }
  });

  it('winds every cell the same way across a long stretch of road', () => {
    const path = new RoadPath(SHIPPING_SEED);
    path.ensure(20000 + 100);
    let folded = 0;
    for (let s = 0; s < 20000; s += TER_ROW_STEP * 3) {
      for (let j = 0; j < TER_COLS.length - 1; j++) {
        const [t1, t2] = windingOf(path, s, TER_COLS[j], TER_COLS[j + 1]);
        if (t1 >= 0 || t2 >= 0) folded++;
      }
    }
    expect(folded).toBe(0);
  });

  it('lands every sample inside one of its own cell triangles at a tight bend', () => {
    // The old fold left ~0.005% of samples inside neither triangle of the cell
    // they belong to, so `sampleTerrainMesh` fell back to a parametric guess.
    const path = new RoadPath(SHIPPING_SEED);
    const inside = (A: Corner, B: Corner, C: Corner, px: number, pz: number): boolean => {
      const e0x = B.x - A.x;
      const e0z = B.z - A.z;
      const e1x = C.x - A.x;
      const e1z = C.z - A.z;
      const den = e0x * e1z - e1x * e0z;
      if (Math.abs(den) < 1e-9) return false;
      const w1 = ((px - A.x) * e1z - e1x * (pz - A.z)) / den;
      const w2 = (e0x * (pz - A.z) - (px - A.x) * e0z) / den;
      return w1 >= -1e-6 && w2 >= -1e-6 && 1 - w1 - w2 >= -1e-6;
    };
    for (const S of TIGHT) {
      path.ensure(S + 400);
      for (let s = S - 60; s <= S + 60; s += 1.7) {
        for (let j = 0; j < TER_COLS.length - 1; j++) {
          for (const f of [0.13, 0.5, 0.87]) {
            const lat = TER_COLS[j] + (TER_COLS[j + 1] - TER_COLS[j]) * f;
            const [a, b, c, d] = cell(path, s, lat);
            const p = path.point(s, lat, new THREE.Vector3());
            const covered = inside(a, b, c, p.x, p.z) || inside(b, d, c, p.x, p.z);
            expect(covered, `s=${s} lat=${lat} landed in neither triangle`).toBe(true);
          }
        }
      }
    }
  });

  it('leaves the near field alone at every curvature', () => {
    // The compression only ever touches columns past 0.6 of the local radius,
    // which is 52.6 m at the tightest bend the generator can produce — so the
    // road, the car and everything grounded beside them are untouched.
    const path = new RoadPath(SHIPPING_SEED);
    path.ensure(2000);
    for (let s = 0; s < 2000; s += 7) {
      for (const lat of [-48, -30, -18, -10, -5.9, 0, 5.9, 10, 18, 30, 48]) {
        expect(path.effectiveLateral(s, lat)).toBe(lat);
      }
    }
  });
});

describe('terrainRow', () => {
  /**
   * `buildTerrain` and `world/grass.ts` both lay their work out on this one
   * row function, which is what stops the ground cover from drifting off the
   * triangles the renderer draws (docs/ARCHITECTURE.md §5.3).
   */
  it('is exactly the terrain mesh vertex row it is drawn from', () => {
    const path = new RoadPath(20260824);
    const cm = new ChunkManager(path, new THREE.Scene());
    cm.update(600);
    const index = 10;
    const group = cm.root.children[index - (600 / CHUNK_LEN - PLAY_BEHIND)] as THREE.Group;
    // Road and terrain are both indexed grids; the terrain is the one with a
    // TER_COLS-wide row.
    const wanted = (CHUNK_LEN / TER_ROW_STEP + 1) * TER_COLS.length;
    const terrain = group.children.find(
      (c) => (c as THREE.Mesh).geometry?.attributes.position.count === wanted,
    ) as THREE.Mesh;
    const pos = terrain.geometry.attributes.position;
    const cols = TER_COLS.length;
    const row = new Float64Array(cols * TERRAIN_ROW_STRIDE);
    for (let r = 0; r * TER_ROW_STEP <= CHUNK_LEN; r++) {
      terrainRow(path, index * CHUNK_LEN + r * TER_ROW_STEP, row);
      for (let j = 0; j < cols; j++) {
        const v = r * cols + j;
        expect(pos.getX(v) + group.position.x).toBeCloseTo(row[j * TERRAIN_ROW_STRIDE], 3);
        expect(pos.getY(v)).toBeCloseTo(row[j * TERRAIN_ROW_STRIDE + 1], 3);
        expect(pos.getZ(v) + group.position.z).toBeCloseTo(row[j * TERRAIN_ROW_STRIDE + 2], 3);
      }
    }
  });

  it('reports the effective lateral each column landed at', () => {
    const path = new RoadPath(20260824);
    const row = new Float64Array(TER_COLS.length * TERRAIN_ROW_STRIDE);
    terrainRow(path, 100, row);
    for (let j = 0; j < TER_COLS.length; j++) {
      const eff = row[j * TERRAIN_ROW_STRIDE + 3];
      // Never further out than the nominal column, never across the road, and
      // always the value RoadPath.point would have used.
      expect(Math.abs(eff)).toBeLessThanOrEqual(Math.abs(TER_COLS[j]) + 1e-9);
      expect(Math.sign(eff)).toBe(Math.sign(TER_COLS[j]));
      expect(eff).toBe(path.effectiveLateral(100, TER_COLS[j]));
    }
  });
});

describe('scenery clumping', () => {
  function obstaclesOfChunk(cm: ChunkManager, index: number) {
    return [...cm.obstaclesNear(index * CHUNK_LEN + CHUNK_LEN / 2, CHUNK_LEN / 2)].filter(
      (o) => Math.floor(o.s / CHUNK_LEN) === index,
    );
  }

  it('keeps every clump member inside its own chunk', () => {
    // Clump anchors are inset by the run's own reach precisely so no member
    // crosses a seam — a prop that did would be missing or doubled there.
    const cm = new ChunkManager(new RoadPath(20260824), new THREE.Scene());
    cm.update(0);
    let seen = 0;
    for (let index = 0; index < 20; index++) {
      for (const ob of cm.obstaclesNear(index * CHUNK_LEN + 30, 40)) {
        const owner = Number(ob.key.split(':')[0]);
        expect(ob.s).toBeGreaterThanOrEqual(owner * CHUNK_LEN);
        expect(ob.s).toBeLessThanOrEqual((owner + 1) * CHUNK_LEN);
        seen++;
      }
    }
    expect(seen).toBeGreaterThan(10);
  });

  it('emits props in runs rather than one at a time', () => {
    // Uniform scatter over 60 m almost never puts two near-road obstacles
    // within a few metres of each other; clumping does it routinely.
    const cm = new ChunkManager(new RoadPath(20260824), new THREE.Scene());
    cm.update(0);
    let pairs = 0;
    for (let index = 0; index < 22; index++) {
      const obs = obstaclesOfChunk(cm, index).sort((a, b) => a.s - b.s);
      for (let i = 1; i < obs.length; i++) {
        if (Math.abs(obs[i].s - obs[i - 1].s) < 10) pairs++;
      }
    }
    expect(pairs).toBeGreaterThan(3);
  });
});

/**
 * Ground cover follows whatever is looking at the world, which in attract mode
 * is not the car (docs/ARCHITECTURE.md §5.7). The harness below is the one
 * `menuCamera.test.ts` uses for its offline sweeps over the director —
 * `FakeCar` places itself exactly the way `Vehicle` does, and `pickShot` is a
 * seeded `rand` stream that lands the director on a chosen take — reproduced
 * here rather than exported across test files.
 */
const QUALITIES = ['low', 'medium', 'high'] as const;

/** A car driving the given path, placed the way `Vehicle` places it. */
class FakeCar implements CinematicTarget {
  readonly root = { position: new THREE.Vector3() };
  yaw = 0;
  constructor(
    private path: RoadPath,
    public s: number,
    public lateral = 2.1,
    public speedMps = 24,
  ) {
    this.yaw = path.pose(s).heading;
    path.point(s, lateral, this.root.position);
  }
}

/** The rand stream that lands the director on shot `i` with mid-range rolls. */
function pickShot(i: number): () => number {
  const values = [i / MENU_SHOTS.length + 1e-9, 0.5, 0.3, 0.7];
  let n = 0;
  return () => values[n++ % values.length];
}

/**
 * The fastest car attract mode can showcase. `menuCruiseMph` runs the menu at
 * the drawn car's own `baseSpeed`, and `roadsideStatic` leads the car by
 * `clamp(speedMps * 5.4, 95, MENU_MAX_LEAD)` — so anything from 108 km/h up
 * saturates the clamp, which the two fastest cars in the catalog do.
 */
const FASTEST_MPS = Math.max(...CARS.map((c) => c.baseSpeed)) * 0.44704;

/** Chunk indices carrying ground cover, as `ChunkManager` stamped them. */
function grassChunks(cm: ChunkManager): number[] {
  const out: number[] = [];
  cm.root.traverse((o) => {
    if ((o as THREE.InstancedMesh).isInstancedMesh) out.push(o.userData.chunkIndex as number);
  });
  return out.sort((a, b) => a - b);
}

/**
 * Drive the director to one take and hand back the eye it settled on, wired to
 * a manager in `main.ts`'s own order: ribbon first, then the camera, then the
 * cover pass against the vantage the camera actually took. Reversing the last
 * two is the stale-vantage defect — see the ordering test below.
 */
function menuVantage(
  shot: MenuShotId,
  quality: (typeof QUALITIES)[number],
  carS: number,
  speedMps: number,
) {
  const path = new RoadPath(20260824);
  const field = new GrassField(quality);
  const cm = new ChunkManager(path, new THREE.Scene(), field);
  const car = new FakeCar(path, carS, 2.1, speedMps);
  const cam = new MenuCamera(
    new THREE.PerspectiveCamera(58, 16 / 9, 0.3, 9000),
    path,
    pickShot(MENU_SHOTS.findIndex((m) => m.id === shot)),
  );
  cm.setBehind(MENU_BEHIND);
  cm.update(car.s);
  cam.update(car, 1 / 60);
  expect(cam.shotId).toBe(shot);
  const eye: CoverEye = { s: cam.camS };
  cm.updateCover(car.s, eye);
  return { cm, cam, car, eye, ahead: GRASS_TIERS[quality].ahead };
}

describe('coverBand', () => {
  const out: CoverBand = { lo: 0, hi: 0 };

  /**
   * The play path. `main.ts` clears the cover eye in `startGame`, so driving
   * has to resolve to the band it resolved to before the eye existed — one
   * chunk of tail and the tier's reach in front, and nothing else.
   */
  it('is the driving band exactly when no eye is looking', () => {
    for (const quality of QUALITIES) {
      const { ahead } = GRASS_TIERS[quality];
      for (const carS of [0, 37, 600, 4213.5, 90000]) {
        const cur = Math.floor(carS / CHUNK_LEN);
        expect(coverBand(carS, null, ahead, out)).toEqual({
          lo: cur - GRASS_BEHIND,
          hi: cur + ahead,
        });
      }
    }
  });

  /**
   * A union, so the car's own band survives wherever the eye wanders. The car
   * is the subject of every take and pickups are collected against it, so its
   * ground is never traded away for the eye's.
   */
  it('never gives up the car band, wherever the eye stands', () => {
    for (const quality of QUALITIES) {
      const { ahead } = GRASS_TIERS[quality];
      const carS = 12_000;
      const cur = Math.floor(carS / CHUNK_LEN);
      for (const ds of [-48, -8, 0, 26, 58, MENU_MAX_LEAD]) {
        const band = coverBand(carS, { s: carS + ds }, ahead, out);
        expect(band.lo).toBeLessThanOrEqual(cur - GRASS_BEHIND);
        expect(band.hi).toBeGreaterThanOrEqual(cur + ahead);
      }
    }
  });

  /**
   * A cinematic eye has no privileged direction, so it carries the tier's
   * reach on both sides of itself — `craneReveal` aims 42 m behind the car
   * from a vantage ahead of it, `overtake` opens 48 m back.
   */
  it('carries the tier reach on both sides of a detached eye', () => {
    for (const quality of QUALITIES) {
      const { ahead } = GRASS_TIERS[quality];
      for (const ds of [-48, -13.5, 26, 58, MENU_MAX_LEAD]) {
        const carS = 12_000;
        const band = coverBand(carS, { s: carS + ds }, ahead, out);
        const eyeCur = Math.floor((carS + ds) / CHUNK_LEN);
        expect(band.lo).toBeLessThanOrEqual(eyeCur - ahead);
        expect(band.hi).toBeGreaterThanOrEqual(eyeCur + ahead);
      }
    }
  });

  /**
   * One span, not two. From the `roadsideStatic` vantage the road between the
   * eye and the car is in frame for its whole length, and most of it is nearer
   * to the lens than the car is, so a band with a hole in the middle would put
   * the cut back where the defect was.
   */
  it('spans the car and the eye without a gap between them', () => {
    const { ahead } = GRASS_TIERS.high;
    const carS = 12_000;
    const band = coverBand(carS, { s: carS + MENU_MAX_LEAD }, ahead, out);
    expect(band.lo).toBeLessThanOrEqual(Math.floor(carS / CHUNK_LEN));
    expect(band.hi).toBeGreaterThanOrEqual(Math.floor((carS + MENU_MAX_LEAD) / CHUNK_LEN));
  });
});

describe('ground cover under a menu vantage', () => {
  it('showcases a car fast enough to saturate the roadsideStatic clamp', () => {
    expect(FASTEST_MPS * 5.4).toBeGreaterThan(MENU_MAX_LEAD);
  });

  /**
   * The defect. At the clamp the eye stands 260 m in front of the car, while a
   * band centred on the car stops 120-180 m ahead at `low` and 180-240 m at
   * `medium` and `high` — so the long lens looked out over bare ground with a
   * hard cover edge across the middle distance, and the car it was pointed at
   * sat in grass. Every tier, because every tier's `ahead` is short of 260 m.
   */
  for (const quality of QUALITIES) {
    it(`covers the ground the eye stands on at ${quality}`, () => {
      const { cm, cam, car, ahead } = menuVantage('roadsideStatic', quality, 12_000, FASTEST_MPS);
      expect(cam.camS - car.s).toBeCloseTo(MENU_MAX_LEAD, 6);
      const eyeChunk = Math.floor(cam.camS / CHUNK_LEN);
      const carChunk = Math.floor(car.s / CHUNK_LEN);
      const covered = grassChunks(cm);
      // The chunk under the eye, the chunk under the car, and everything
      // between them: all of it is in frame down a 26 degree lens.
      for (let i = carChunk; i <= eyeChunk; i++) expect(covered).toContain(i);
      // And the tier's reach past the eye in both directions, because the shot
      // is free to look either way from there.
      expect(Math.min(...covered)).toBeLessThanOrEqual(eyeChunk - ahead);
      expect(Math.max(...covered)).toBeGreaterThanOrEqual(eyeChunk + ahead);
    });
  }

  /**
   * Every take, not just the one that reaches furthest. `craneReveal` rises
   * ahead of the car and aims 42 m *behind* it; `droneFlyby` and `overtake`
   * sweep to 44-48 m back. Whichever way a shot faces, the cover edge is at
   * least the tier's reach away from the eye.
   */
  it('keeps every shot the tier reach away from both cover edges', () => {
    for (const shot of MENU_SHOTS) {
      const { cm, cam, ahead } = menuVantage(shot.id, 'high', 12_000, FASTEST_MPS);
      const covered = grassChunks(cm);
      const eyeChunk = Math.floor(cam.camS / CHUNK_LEN);
      expect(covered).toContain(eyeChunk);
      expect(Math.min(...covered)).toBeLessThanOrEqual(eyeChunk - ahead);
      expect(Math.max(...covered)).toBeGreaterThanOrEqual(eyeChunk + ahead);
    }
  });

  /**
   * The band is still a band. Nineteen extra chunks of terrain is what the
   * menu tail costs (`MENU_BEHIND`); ground cover must not follow it — the
   * whole point of §5.7's near band is that it is never the `AHEAD` window.
   */
  it('stays a handful of chunks rather than the whole menu ribbon', () => {
    const { cm } = menuVantage('roadsideStatic', 'high', 12_000, FASTEST_MPS);
    expect(cm.root.children.length).toBeGreaterThan(40);
    expect(grassChunks(cm).length).toBeLessThanOrEqual(11);
  });

  /** Driving builds what driving always built: no cover eye, no extra chunks. */
  it('hands the extra chunks back when the eye is cleared', () => {
    const { cm, car } = menuVantage('roadsideStatic', 'high', 12_000, FASTEST_MPS);
    const menuCount = grassChunks(cm).length;
    cm.updateCover(car.s, null);
    expect(grassChunks(cm).length).toBe(GRASS_BEHIND + GRASS_TIERS.high.ahead + 1);
    expect(menuCount).toBeGreaterThan(GRASS_BEHIND + GRASS_TIERS.high.ahead + 1);
  });
});

/**
 * `ChunkManager.update` and `ChunkManager.updateCover` are two passes on
 * purpose, and the order between them is the whole point: the ribbon has to be
 * built before the camera (the menu director samples the terrain the chunks
 * own to choose and clear its vantage), and cover has to be banded after it
 * (cover follows wherever the camera ended up).
 *
 * These pin that as a fact about the world. What they cannot do is read
 * `main.ts` and prove the frame loop still calls them that way round — the
 * source check below is the closest thing, and the live attract-mode run in the
 * PR is what actually confirms it.
 */
describe('the cover pass belongs after the camera', () => {
  /**
   * A `rand` stream that walks the director through `ids` in order, one cut
   * each. The director draws four numbers per cut — shot, duration, side, roll
   * — and picks its shot out of all eight on the first cut and out of the seven
   * that are not on screen thereafter, so the first draw is solved for the
   * target rather than guessed.
   */
  function shotScript(ids: MenuShotId[]): () => number {
    const targets = ids.map((id) => MENU_SHOTS.findIndex((m) => m.id === id));
    const rest = [0.5, 0.3, 0.7];
    let current = -1;
    let cut = 0;
    let draw = 0;
    return () => {
      const phase = draw++ % 4;
      if (phase !== 0) return rest[phase - 1];
      const target = targets[Math.min(cut++, targets.length - 1)];
      const first = current < 0;
      const pick = first ? target : target > current ? target - 1 : target;
      current = target;
      return pick / (first ? MENU_SHOTS.length : MENU_SHOTS.length - 1) + 1e-9;
    };
  }

  /**
   * Run the frames a cut lands on, in one of the two orders, and report
   * whether the chunk the eye is standing on when the frame is *rendered*
   * carries ground cover.
   *
   * `eye` is a live view of `cam.camS`, exactly as `main.ts` holds it, so
   * running the cover pass before the director is what makes it read the
   * outgoing take's vantage — no staleness is simulated here, it falls out of
   * the order.
   */
  function coveredAtRender(coverAfterCamera: boolean): boolean[] {
    const path = new RoadPath(20260824);
    const field = new GrassField('high');
    const cm = new ChunkManager(path, new THREE.Scene(), field);
    const cam = new MenuCamera(
      new THREE.PerspectiveCamera(58, 16 / 9, 0.3, 9000),
      path,
      shotScript(['lowChase', 'roadsideStatic']),
    );
    const car = new FakeCar(path, 12_000, 2.1, FASTEST_MPS);
    const eye: CoverEye = {
      get s(): number {
        return cam.camS;
      },
    };
    cm.setBehind(MENU_BEHIND);
    // Enter the menu the way `enterMenu` does: ribbon, director, then cover.
    cm.update(car.s);
    cam.update(car, 1 / 60);
    cm.updateCover(car.s, eye);
    expect(cam.shotId).toBe('lowChase');

    const out: boolean[] = [];
    for (let f = 0; f < 6; f++) {
      // The sixth frame runs the take past its duration, so it cuts — to
      // `roadsideStatic`, which at this speed latches the `MENU_MAX_LEAD` clamp.
      const dt = f === 5 ? 20 : 1 / 60;
      car.s += car.speedMps * (1 / 60);
      cm.update(car.s);
      if (coverAfterCamera) {
        cam.update(car, dt);
        cm.updateCover(car.s, eye);
      } else {
        cm.updateCover(car.s, eye);
        cam.update(car, dt);
      }
      out.push(grassChunks(cm).includes(Math.floor(cam.camS / CHUNK_LEN)));
    }
    expect(cam.shotId).toBe('roadsideStatic');
    expect(cam.camS - car.s).toBeCloseTo(MENU_MAX_LEAD, 6);
    return out;
  }

  /**
   * The defect the split exists to close. Resolving the band with the ribbon
   * costs nothing while the eye is walking — five frames of a dolly move it a
   * metre — but a cut moves it 260 m between one frame and the next, and that
   * frame renders a fresh vantage standing on ground with no cover on it.
   */
  it('leaves the cut frame uncovered when it runs with the ribbon instead', () => {
    const seen = coveredAtRender(false);
    expect(seen.slice(0, 5)).toEqual([true, true, true, true, true]);
    expect(seen[5]).toBe(false);
  });

  /** And with the pass where `main.ts` puts it, no frame is ever uncovered. */
  it('covers every frame, cuts included, when it runs after the camera', () => {
    expect(coveredAtRender(true)).toEqual([true, true, true, true, true, true]);
  });

  /**
   * Deliberately literal: the two passes are only correct in one order and
   * nothing else in the suite can see the frame loop. If `main.ts` is
   * restructured this should fail and be re-read, not deleted — the ordering
   * is the contract, the line numbers are not.
   */
  it('is where main.ts actually calls it', () => {
    const src = readFileSync(new URL('../main.ts', import.meta.url), 'utf8');
    const ribbon = src.indexOf('chunks.update(vehicle.s);\n  pickups.update(');
    const camera = src.indexOf('if (menuMode) menuCam.update(vehicle, dt);');
    const cover = src.indexOf('chunks.updateCover(vehicle.s, menuMode ?');
    expect(ribbon).toBeGreaterThan(0);
    expect(camera).toBeGreaterThan(ribbon);
    expect(cover).toBeGreaterThan(camera);
  });
});

describe('the cover pass in play', () => {
  /** One frame of the loop with the chase camera holding it: no eye at all. */
  function frame(cm: ChunkManager, carS: number): void {
    cm.update(carS);
    cm.updateCover(carS, null);
  }

  /**
   * The split must not have made driving do more work. Counted rather than
   * inferred: a band that rebuilt itself every frame would hold exactly the
   * same meshes and look identical from the outside (§5.7, §14).
   */
  it('builds one cover chunk per chunk boundary and nothing in between', () => {
    const path = new RoadPath(20260824);
    const field = new GrassField('high');
    const cm = new ChunkManager(path, new THREE.Scene(), field);
    frame(cm, 12_000);
    const builds = vi.spyOn(field, 'build');

    // Four frames inside one chunk: the band does not move, so nothing builds.
    for (let f = 1; f <= 4; f++) frame(cm, 12_000 + f);
    expect(builds).not.toHaveBeenCalled();

    // And exactly one chunk per boundary crossed, over a dozen of them.
    for (let i = 1; i <= 12; i++) {
      builds.mockClear();
      frame(cm, 12_000 + i * CHUNK_LEN);
      expect(builds).toHaveBeenCalledTimes(1);
      expect(grassChunks(cm).length).toBe(GRASS_BEHIND + GRASS_TIERS.high.ahead + 1);
    }
    builds.mockRestore();
  });

  /**
   * And the chunks it lands on are the driving band, exactly — the union
   * collapses to it when nothing but the chase rig is looking.
   */
  it('lands on the driving band at every tier', () => {
    for (const quality of QUALITIES) {
      const cm = new ChunkManager(
        new RoadPath(20260824),
        new THREE.Scene(),
        new GrassField(quality),
      );
      const carS = 12_000 + 17;
      frame(cm, carS);
      const cur = Math.floor(carS / CHUNK_LEN);
      const expected: number[] = [];
      for (let i = cur - GRASS_BEHIND; i <= cur + GRASS_TIERS[quality].ahead; i++) expected.push(i);
      expect(grassChunks(cm)).toEqual(expected);
    }
  });
});
