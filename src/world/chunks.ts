import * as THREE from 'three';
import { RoadPath, DS } from './roadPath';
import { BIOMES, biomeAt, blendColor, blendNumber, pickScenery, type SceneryKind } from './biomes';
import { getProto } from './scenery';
import { vertexToonMat, rng, noise2, jitterColor } from './materials';

export const CHUNK_LEN = 60;
const AHEAD = 22; // chunks ahead of the car (~1.3 km)
/**
 * Chunks retained behind the car. Exported because a path re-seed has to
 * keep at least this much road behind the car for them to be built from real
 * samples rather than a clamped lookup.
 */
export const BEHIND = 3;

/** Roadside object the pickups system can near-miss against. */
export interface Obstacle {
  s: number;
  lateral: number;
  radius: number;
  key: string;
}

interface Chunk {
  index: number;
  group: THREE.Group;
  obstacles: Obstacle[];
  geos: THREE.BufferGeometry[];
}

/**
 * Terrain lateral columns in meters from the centerline, nonuniform so the
 * land is finely sampled beside the road and coarse out in the fields. The
 * terrain mesh is built on exactly this column set (§5.3), so anything that
 * grounds to the *drawn* surface has to walk the same grid.
 */
export const TER_COLS = [
  -165, -115, -75, -48, -30, -18, -10, -5.9, 5.9, 10, 18, 30, 48, 75, 115, 165,
];
/**
 * Terrain grid spacing along s, in meters. Divides CHUNK_LEN evenly, so rows
 * land on the same absolute s in every chunk and seams stay watertight.
 */
export const TER_ROW_STEP = 6;

/**
 * The land height field at (s, lat) given the road's own elevation there.
 * Split out of `terrainHeight` so callers that already hold `roadY` — a
 * terrain row, a sampled grid cell — do not re-walk the path per column.
 */
function landHeight(roadY: number, s: number, lat: number): number {
  const a = Math.abs(lat);
  const hills = noise2(s * 0.006, lat * 0.011) * 7 + noise2(s * 0.0016, lat * 0.0028) * 16;
  const far = THREE.MathUtils.smoothstep(a, 55, 160);
  const rise = far * (10 + noise2(s * 0.001, lat * 0.002) * 14);
  const blendK = THREE.MathUtils.smoothstep(a, 6.2, 30);
  return roadY - 0.06 + blendK * (hills * 0.55 + rise) - blendK * 1.2;
}

/**
 * Terrain height field in path space. This is the *analytic* surface, sampled
 * by the terrain mesh at its grid vertices — between them the drawn surface is
 * the flat triangle, so use `sampleTerrainMesh` to stand something on the land.
 */
export function terrainHeight(path: RoadPath, s: number, lat: number): number {
  return landHeight(path.elevation(s), s, lat);
}

/** A point on the terrain as it is actually rendered. */
export interface TerrainSample {
  /** World-space height of the drawn surface (absolute, not chunk-local). */
  y: number;
  /** Unit face normal of the triangle under the point, always pointing up. */
  normal: THREE.Vector3;
  /**
   * True when the cell folded over itself in XZ, so `normal` was flipped back
   * up and its slope DIRECTION is mirrored — meaningless, not merely noisy.
   * Callers must not lean anything along it. See `fillFromTriangle`.
   */
  folded: boolean;
}

/** Allocate a reusable `TerrainSample` — sampling itself allocates nothing. */
export function createTerrainSample(): TerrainSample {
  return { y: 0, normal: new THREE.Vector3(0, 1, 0), folded: false };
}

// Cell corners for sampleTerrainMesh: 0 = (s0,l0) 1 = (s0,l1) 2 = (s1,l0)
// 3 = (s1,l1). Module scope so per-prop sampling stays allocation-free.
const cornerX = new Float64Array(4);
const cornerY = new Float64Array(4);
const cornerZ = new Float64Array(4);
const poseLo = { pos: new THREE.Vector3(), heading: 0 };
const poseHi = { pos: new THREE.Vector3(), heading: 0 };
const queryP = new THREE.Vector3();
const edgeU = new THREE.Vector3();
const edgeV = new THREE.Vector3();
/** Barycentric slack, in normalized weight units, for on-edge points. */
const BARY_EPS = 1e-6;

/**
 * Height and face normal of the terrain *as drawn* at (s, lat).
 *
 * `terrainHeight` is the smooth field the terrain mesh samples at its grid
 * vertices; between them the rendered surface is the flat triangle, which on a
 * slope or a hill crest sits metres away from the field. Scenery grounds to
 * this function so props touch the surface the player actually sees
 * (docs/ARCHITECTURE.md §5.3, §5.7).
 *
 * Writes into `out` using module-scope scratch, so it is not reentrant: never
 * call it again before you are done reading the previous result.
 */
export function sampleTerrainMesh(
  path: RoadPath,
  s: number,
  lat: number,
  out: TerrainSample,
): TerrainSample {
  // Beyond the meshed span nothing is drawn, so the edge column is the nearest
  // surface there is to stand on.
  const l = THREE.MathUtils.clamp(lat, TER_COLS[0], TER_COLS[TER_COLS.length - 1]);
  let j = 0;
  while (j < TER_COLS.length - 2 && l > TER_COLS[j + 1]) j++;
  const l0 = TER_COLS[j];
  const l1 = TER_COLS[j + 1];
  const s0 = Math.floor(s / TER_ROW_STEP) * TER_ROW_STEP;
  const s1 = s0 + TER_ROW_STEP;

  path.pose(s0, poseLo);
  path.pose(s1, poseHi);
  fillCorner(0, poseLo, s0, l0);
  fillCorner(1, poseLo, s0, l1);
  fillCorner(2, poseHi, s1, l0);
  fillCorner(3, poseHi, s1, l1);
  path.point(s, l, queryP);

  // gridIndices emits (a,b,c) then (b,d,c), so the cell's diagonal runs from
  // the near row's far column to the far row's near column. Splitting the
  // other way leaves props off by the whole diagonal error.
  if (triangleAt(0, 1, 2, queryP.x, queryP.z, out)) return out;
  if (triangleAt(1, 3, 2, queryP.x, queryP.z, out)) return out;

  // Far out on a tight curve the lateral mapping folds over itself and the
  // point can land in neither triangle (measured at 0.008% of samples over
  // 20 km, none inside |lat| 108). Fall back to the parametric split.
  const u = (s - s0) / TER_ROW_STEP;
  const v = (l - l0) / (l1 - l0);
  if (u + v <= 1) fillFromTriangle(0, 1, 2, 1 - u - v, v, u, out);
  else fillFromTriangle(1, 3, 2, 1 - u, u + v - 1, 1 - v, out);
  return out;
}

const sharedSample = createTerrainSample();

/** Height of the drawn terrain at (s, lat). Normal-free convenience wrapper. */
export function terrainMeshHeight(path: RoadPath, s: number, lat: number): number {
  return sampleTerrainMesh(path, s, lat, sharedSample).y;
}

function fillCorner(
  i: number,
  pose: { pos: THREE.Vector3; heading: number },
  s: number,
  lat: number,
): void {
  // Right-hand normal of the heading, matching RoadPath.point exactly.
  const nx = -Math.cos(pose.heading);
  const nz = Math.sin(pose.heading);
  cornerX[i] = pose.pos.x + nx * lat;
  cornerZ[i] = pose.pos.z + nz * lat;
  cornerY[i] = landHeight(pose.pos.y, s, lat);
}

/**
 * Barycentric lookup of (px, pz) in one cell triangle, projected to XZ.
 * Returns false when the point is outside it or the triangle is degenerate.
 */
function triangleAt(
  i0: number,
  i1: number,
  i2: number,
  px: number,
  pz: number,
  out: TerrainSample,
): boolean {
  const e0x = cornerX[i1] - cornerX[i0];
  const e0z = cornerZ[i1] - cornerZ[i0];
  const e1x = cornerX[i2] - cornerX[i0];
  const e1z = cornerZ[i2] - cornerZ[i0];
  const den = e0x * e1z - e1x * e0z;
  if (Math.abs(den) < 1e-9) return false;
  const dx = px - cornerX[i0];
  const dz = pz - cornerZ[i0];
  const w1 = (dx * e1z - e1x * dz) / den;
  const w2 = (e0x * dz - dx * e0z) / den;
  const w0 = 1 - w1 - w2;
  if (w0 < -BARY_EPS || w1 < -BARY_EPS || w2 < -BARY_EPS) return false;
  fillFromTriangle(i0, i1, i2, w0, w1, w2, out);
  return true;
}

/** Interpolate height and take the face normal of one cell triangle. */
function fillFromTriangle(
  i0: number,
  i1: number,
  i2: number,
  w0: number,
  w1: number,
  w2: number,
  out: TerrainSample,
): void {
  out.y = w0 * cornerY[i0] + w1 * cornerY[i1] + w2 * cornerY[i2];
  edgeU.set(cornerX[i1] - cornerX[i0], cornerY[i1] - cornerY[i0], cornerZ[i1] - cornerZ[i0]);
  edgeV.set(cornerX[i2] - cornerX[i0], cornerY[i2] - cornerY[i0], cornerZ[i2] - cornerZ[i0]);
  out.normal.crossVectors(edgeU, edgeV);
  const len = out.normal.length();
  if (len < 1e-9) {
    out.normal.set(0, 1, 0);
    out.folded = false;
    return;
  }
  out.normal.divideScalar(len);
  // A cell whose lateral mapping inverted (the road's minimum radius of
  // curvature is ~88 m while TER_COLS reaches ±165 m, so the far field folds
  // on tight bends: ~0.7% of cells past |lat| 90, ~6% past 150) winds
  // backwards and crosses downward. Flip it up so the value is at least
  // usable as a surface, but flag it — the slope it describes points the
  // wrong way, so leaning a prop along it tilts it the wrong way.
  if (out.normal.y < 0) {
    out.normal.negate();
    out.folded = true;
  } else {
    out.folded = false;
  }
}

/**
 * How far each scenery kind leans toward the terrain face it stands on:
 * 1 = flush with the slope, 0 = bolt upright. Things that lie on the ground
 * follow it; things with a trunk or a foundation grew/were built vertical and
 * only pick up a hint of the lean (docs/ARCHITECTURE.md §5.7).
 */
export const SLOPE_FOLLOW: Record<SceneryKind, number> = {
  oak: 0.2,
  maple: 0.2,
  pine: 0.15,
  poplar: 0.12,
  cherryTree: 0.2,
  rock: 1,
  flowers: 0.95,
  grassTuft: 1,
  hay: 0.9,
  fence: 0.8,
  windmill: 0.1,
  sunflowerPatch: 0.85,
  lavenderRow: 0.85,
  reeds: 0.9,
};
/**
 * Ceiling on the face angle a prop will answer to, in radians (~29°). Real
 * land tops out near 26°; anything steeper is the far-field cell fold, and
 * without the cap a prop out there would lie down.
 */
const MAX_TILT = 0.5;
/** Sink for a prop lying flush with the face — just enough to kill the seam. */
const SINK_FLUSH = 0.03;
/**
 * Sink for a prop kept upright on a slope: its base has to bury far enough
 * that the downhill edge does not lift off. Interpolated by SLOPE_FOLLOW.
 */
const SINK_UPRIGHT = 0.14;

const tiltEuler = new THREE.Euler();
const tiltAxis = new THREE.Vector3();
const tiltQuat = new THREE.Quaternion();

/**
 * Orientation for one scenery prop: its yaw, leaned `follow` of the way from
 * world-up toward the terrain face normal and capped at `MAX_TILT`. Pure and
 * deterministic — it draws no random numbers, so seeded placement is untouched.
 */
export function propOrientation(
  yaw: number,
  normal: THREE.Vector3,
  follow: number,
  out: THREE.Quaternion,
): THREE.Quaternion {
  out.setFromEuler(tiltEuler.set(0, yaw, 0));
  const face = Math.acos(THREE.MathUtils.clamp(normal.y, -1, 1));
  const lean = Math.min(face, MAX_TILT) * follow;
  if (lean > 1e-4) {
    // Rotating world-up about (up x normal) swings it toward the normal.
    tiltAxis.set(normal.z, 0, -normal.x);
    if (tiltAxis.lengthSq() > 1e-12) {
      out.premultiply(tiltQuat.setFromAxisAngle(tiltAxis.normalize(), lean));
    }
  }
  return out;
}

const groundSample = createTerrainSample();

/**
 * Settle one scenery prop onto the land: returns the world height its origin
 * sits at — the terrain *as drawn*, sunk by as much as its uprightness needs —
 * and writes its orientation into `outQuat`. Deterministic in (s, lat, yaw),
 * so it draws no random numbers and leaves seeded placement untouched.
 */
export function groundProp(
  path: RoadPath,
  s: number,
  lat: number,
  kind: SceneryKind,
  yaw: number,
  outQuat: THREE.Quaternion,
): number {
  sampleTerrainMesh(path, s, lat, groundSample);
  // Stand upright rather than lean the wrong way on a folded cell.
  const follow = groundSample.folded ? 0 : SLOPE_FOLLOW[kind];
  propOrientation(yaw, groundSample.normal, follow, outQuat);
  return groundSample.y - THREE.MathUtils.lerp(SINK_UPRIGHT, SINK_FLUSH, follow);
}

// Road cross-section: lateral offsets + which paint each column carries.
const ROAD_COLS = [-5.5, -4.65, -4.35, -4.05, -0.5, -0.16, 0.16, 0.5, 4.05, 4.35, 4.65, 5.5];
type Paint = 'dirt' | 'asphalt' | 'edge' | 'dash';
const ROAD_PAINT: Paint[] = [
  'dirt',
  'asphalt',
  'edge',
  'asphalt',
  'asphalt',
  'dash',
  'dash',
  'asphalt',
  'asphalt',
  'edge',
  'asphalt',
  'dirt',
];

const COL_DIRT = new THREE.Color('#96795a');
const COL_ASPHALT = new THREE.Color('#4d4d5c');
const COL_CREAM = new THREE.Color('#f2e5c0');

export class ChunkManager {
  private chunks = new Map<number, Chunk>();
  private mat = vertexToonMat();
  readonly root = new THREE.Group();

  constructor(
    private path: RoadPath,
    private scene: THREE.Scene,
  ) {
    scene.add(this.root);
  }

  update(carS: number): void {
    const cur = Math.floor(carS / CHUNK_LEN);
    for (let i = cur - BEHIND; i <= cur + AHEAD; i++) {
      if (i >= 0 && !this.chunks.has(i)) this.buildChunk(i);
    }
    for (const [idx, chunk] of this.chunks) {
      if (idx < cur - BEHIND || idx > cur + AHEAD) {
        this.root.remove(chunk.group);
        for (const g of chunk.geos) g.dispose();
        this.chunks.delete(idx);
      }
    }
    this.path.prune(carS - BEHIND * CHUNK_LEN - 100);
  }

  /**
   * Dispose every live chunk. Called when the car teleports along the path and
   * the road is re-seeded (RoadPath.reset), after which cached chunk geometry
   * no longer matches the curve it was built from.
   */
  reset(): void {
    for (const chunk of this.chunks.values()) {
      this.root.remove(chunk.group);
      for (const g of chunk.geos) g.dispose();
    }
    this.chunks.clear();
  }

  shiftOrigin(dx: number, dz: number): void {
    for (const chunk of this.chunks.values()) {
      chunk.group.position.x += dx;
      chunk.group.position.z += dz;
    }
  }

  /**
   * True while chunk `index` is still generated. Once it is false the chunk's
   * obstacles can never be yielded by obstaclesNear again, so anything keyed
   * to them (near-miss dedupe) is safe to drop.
   */
  hasChunk(index: number): boolean {
    return this.chunks.has(index);
  }

  /** Obstacles within `range` meters of path distance s. */
  *obstaclesNear(s: number, range: number): Generator<Obstacle> {
    const lo = Math.floor((s - range) / CHUNK_LEN);
    const hi = Math.floor((s + range) / CHUNK_LEN);
    for (let i = lo; i <= hi; i++) {
      const c = this.chunks.get(i);
      if (!c) continue;
      for (const ob of c.obstacles) {
        if (Math.abs(ob.s - s) <= range) yield ob;
      }
    }
  }

  // ------------------------------------------------------------------
  private buildChunk(index: number): void {
    const s0 = index * CHUNK_LEN;
    const s1 = s0 + CHUNK_LEN;
    this.path.ensure(s1 + DS);

    const group = new THREE.Group();
    // Anchor the group at the chunk start so vertex coords stay small.
    const anchor = this.path.pose(s0).pos.clone();
    anchor.y = 0;
    group.position.copy(anchor);

    const geos: THREE.BufferGeometry[] = [];
    const road = this.buildRoad(s0, s1, anchor);
    geos.push(road.geometry);
    group.add(road);
    const terrain = this.buildTerrain(s0, s1, anchor);
    geos.push(terrain.geometry);
    group.add(terrain);

    const obstacles: Obstacle[] = [];
    const scenery = this.buildScenery(index, s0, s1, anchor, obstacles);
    if (scenery) {
      geos.push(scenery.geometry);
      group.add(scenery);
    }

    this.root.add(group);
    this.chunks.set(index, { index, group, obstacles, geos });
  }

  private buildRoad(s0: number, s1: number, anchor: THREE.Vector3): THREE.Mesh {
    const rows = Math.round((s1 - s0) / DS) + 1;
    const cols = ROAD_COLS.length;
    const pos = new Float32Array(rows * cols * 3);
    const col = new Float32Array(rows * cols * 3);
    const p = new THREE.Vector3();
    const c = new THREE.Color();

    for (let r = 0; r < rows; r++) {
      const s = s0 + r * DS;
      const dashOn = Math.floor(s / 4) % 2 === 0;
      for (let j = 0; j < cols; j++) {
        this.path.point(s, ROAD_COLS[j], p);
        const k = (r * cols + j) * 3;
        pos[k] = p.x - anchor.x;
        pos[k + 1] = p.y + 0.02;
        pos[k + 2] = p.z - anchor.z;
        const paint = ROAD_PAINT[j];
        if (paint === 'dirt') c.copy(COL_DIRT);
        else if (paint === 'edge') c.copy(COL_CREAM);
        else if (paint === 'dash') c.copy(dashOn ? COL_CREAM : COL_ASPHALT);
        else c.copy(COL_ASPHALT);
        // subtle painterly variation
        const v = 1 + noise2(s * 0.13, j * 1.7) * 0.05;
        col[k] = c.r * v;
        col[k + 1] = c.g * v;
        col[k + 2] = c.b * v;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(gridIndices(rows, cols));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, this.mat);
    mesh.receiveShadow = true;
    return mesh;
  }

  private buildTerrain(s0: number, s1: number, anchor: THREE.Vector3): THREE.Mesh {
    const rows = Math.round((s1 - s0) / TER_ROW_STEP) + 1;
    const cols = TER_COLS.length;
    const pos = new Float32Array(rows * cols * 3);
    const col = new Float32Array(rows * cols * 3);
    const p = new THREE.Vector3();
    const ground = new THREE.Color();
    const groundAlt = new THREE.Color();
    const mixed = new THREE.Color();

    for (let r = 0; r < rows; r++) {
      const s = s0 + r * TER_ROW_STEP;
      const roadY = this.path.elevation(s);
      blendColor(s, (b) => b.ground, ground);
      blendColor(s, (b) => b.groundAlt, groundAlt);
      for (let j = 0; j < cols; j++) {
        const lat = TER_COLS[j];
        this.path.point(s, lat, p);
        const k = (r * cols + j) * 3;
        pos[k] = p.x - anchor.x;
        pos[k + 1] = landHeight(roadY, s, lat);
        pos[k + 2] = p.z - anchor.z;
        // Color: noise blend between ground tones + gentle brightness wobble.
        const t = noise2(s * 0.02 + 7, lat * 0.03) * 0.5 + 0.5;
        mixed.copy(ground).lerp(groundAlt, t);
        const v = 1 + noise2(s * 0.09, lat * 0.11 + 3) * 0.07;
        col[k] = mixed.r * v;
        col[k + 1] = mixed.g * v;
        col[k + 2] = mixed.b * v;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(gridIndices(rows, cols));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, this.mat);
    mesh.receiveShadow = true;
    return mesh;
  }

  private buildScenery(
    index: number,
    s0: number,
    s1: number,
    anchor: THREE.Vector3,
    obstacles: Obstacle[],
  ): THREE.Mesh | null {
    const r = rng((index * 2654435761) % 4294967291);
    const count = Math.round(
      blendNumber(s0 + CHUNK_LEN / 2, (b) => b.density) * (0.85 + r() * 0.3),
    );

    const posOut: number[] = [];
    const normOut: number[] = [];
    const colOut: number[] = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const vec = new THREE.Vector3();
    const nrm = new THREE.Vector3();
    const nm = new THREE.Matrix3();
    const tint = new THREE.Color();
    const worldP = new THREE.Vector3();

    for (let i = 0; i < count; i++) {
      const s = s0 + r() * (s1 - s0);
      const kind = pickScenery(s, r());
      const proto = getProto(kind);
      const side = r() < 0.5 ? -1 : 1;
      let lat: number;
      switch (kind) {
        case 'fence':
        case 'hay':
          lat = side * (6.8 + r() * 6);
          break;
        case 'windmill':
          lat = side * (45 + r() * 90);
          break;
        case 'sunflowerPatch':
        case 'lavenderRow':
          lat = side * (9 + r() * 55);
          break;
        case 'flowers':
        case 'grassTuft':
          lat = side * (6.5 + r() * 40);
          break;
        default:
          lat = side * (10.5 + r() * 128);
      }

      let scale =
        kind === 'windmill'
          ? 0.9 + r() * 0.4
          : kind === 'rock'
            ? 0.6 + r() * 1.1
            : 0.75 + r() * 0.6;
      // Keep trees hugging the road smaller so canopies never swallow the camera.
      const isTree =
        kind === 'oak' ||
        kind === 'maple' ||
        kind === 'pine' ||
        kind === 'poplar' ||
        kind === 'cherryTree';
      if (isTree && Math.abs(lat) < 17) scale = Math.min(scale, 0.9);

      // Rows and fences align with the road; everything else spins freely.
      const heading = this.path.heading(s);
      const yaw =
        kind === 'fence' || kind === 'lavenderRow' || kind === 'sunflowerPatch'
          ? heading + Math.PI / 2 + (r() - 0.5) * 0.15
          : r() * Math.PI * 2;

      this.path.point(s, lat, worldP);
      // Ground to the terrain as drawn, not to the height field the mesh only
      // samples at its grid vertices — between them they differ by metres.
      const y = groundProp(this.path, s, lat, kind, yaw, q);

      // Instance tint: canopy/flower/rock palette blended at s.
      pickTint(s, kind, r, tint);

      m.compose(vec.set(worldP.x - anchor.x, y, worldP.z - anchor.z), q, tmpScale.setScalar(scale));
      nm.getNormalMatrix(m);

      const { pos, norm, baked, shade, mask, vertexCount, radius } = proto;
      for (let vI = 0; vI < vertexCount; vI++) {
        vec.set(pos[vI * 3], pos[vI * 3 + 1], pos[vI * 3 + 2]).applyMatrix4(m);
        nrm
          .set(norm[vI * 3], norm[vI * 3 + 1], norm[vI * 3 + 2])
          .applyMatrix3(nm)
          .normalize();
        posOut.push(vec.x, vec.y, vec.z);
        normOut.push(nrm.x, nrm.y, nrm.z);
        const sh = shade[vI];
        if (mask[vI] > 0.5) {
          colOut.push(tint.r * sh, tint.g * sh, tint.b * sh);
        } else {
          colOut.push(baked[vI * 3] * sh, baked[vI * 3 + 1] * sh, baked[vI * 3 + 2] * sh);
        }
      }

      // Near-shoulder solid objects become near-miss targets.
      if ((kind === 'hay' || kind === 'rock' || kind === 'fence') && Math.abs(lat) < 10) {
        obstacles.push({ s, lateral: lat, radius: radius * scale, key: `${index}:${i}` });
      }
    }

    if (!posOut.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(posOut), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normOut), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colOut), 3));
    const mesh = new THREE.Mesh(geo, this.mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }
}

const tmpScale = new THREE.Vector3();

function pickTint(s: number, kind: SceneryKind, r: () => number, out: THREE.Color): void {
  const sample = biomeAt(s);
  // Choose a biome proportional to blend weights, then a palette entry.
  let pickRoll = r();
  let biome = BIOMES[sample.id];
  for (const { id, w } of sample.weights) {
    pickRoll -= w;
    if (pickRoll <= 0) {
      biome = BIOMES[id];
      break;
    }
  }
  let base: string;
  if (kind === 'flowers' || kind === 'sunflowerPatch' || kind === 'lavenderRow') {
    base = biome.flowerColors[Math.floor(r() * biome.flowerColors.length)];
  } else if (kind === 'rock') {
    base = r() < 0.5 ? '#a8a49a' : '#8f8c85';
  } else if (kind === 'grassTuft') {
    base = r() < 0.5 ? biome.ground : biome.groundAlt;
  } else {
    base = biome.canopy[Math.floor(r() * biome.canopy.length)];
  }
  out.copy(jitterColor(tmpColor.set(base), r, 0.07));
}

const tmpColor = new THREE.Color();

function gridIndices(rows: number, cols: number): THREE.BufferAttribute {
  const idx = new Uint32Array((rows - 1) * (cols - 1) * 6);
  let k = 0;
  for (let r = 0; r < rows - 1; r++) {
    for (let j = 0; j < cols - 1; j++) {
      const a = r * cols + j;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      // Winding chosen so faces point up with the right-hand lateral axis.
      idx[k++] = a;
      idx[k++] = b;
      idx[k++] = c;
      idx[k++] = b;
      idx[k++] = d;
      idx[k++] = c;
    }
  }
  return new THREE.BufferAttribute(idx, 1);
}
