import * as THREE from 'three';
import { RoadPath, DS, foldSafeLateral } from './roadPath';
import {
  BIOMES,
  biomeAt,
  blendColor,
  blendNumber,
  createBiomeSample,
  pickScenery,
  type SceneryKind,
} from './biomes';
import { getProto } from './scenery';
// Type-only: grass.ts imports this module for the terrain grid, so a value
// import here would close the cycle and put TER_COLS in the temporal dead zone
// while grass.ts builds its band table at module scope.
import type { GrassField } from './grass';
import { vertexToonMat, rng, noise2, jitterColor } from './materials';

export const CHUNK_LEN = 60;
/**
 * Chunks generated ahead of the car (~1.3 km).
 *
 * Exported because `AHEAD * CHUNK_LEN` is where the ribbon stops, and two other
 * modules are sized against that distance: `main.ts`'s `FOG_BASE_DENSITY` is
 * chosen so the haze has closed over the cut by then, and `farLand.ts`'s
 * backdrop stands on the ground behind it, so it meets the cut at whatever
 * haze the cut itself carries. Moving this moves both.
 */
export const AHEAD = 22;
/**
 * Chunks retained behind the car while driving. The chase camera sits ~8 m
 * back and looks forward, so nothing ever sees the rear boundary in play and
 * three chunks is pure slack.
 */
export const PLAY_BEHIND = 3;
/**
 * Chunks retained behind the car in attract mode.
 *
 * The menu director is the only rig that ever looks *back* down the road, and
 * several of its shots stand ahead of the car to do it — `roadsideStatic`
 * anchors as much as `MENU_MAX_LEAD` metres in front of it. At `PLAY_BEHIND`
 * the ribbon ends 180 m behind the car, and the cut reads as a stepped cliff
 * with haze under the props standing on its lip — the "terrain unloading
 * behind the car" report. Measured on the live attract mode, 24 of its samples
 * are directly visible, the nearest at 193 m.
 *
 * Ten chunks did not fix that, and the arithmetic that said it did was the
 * wrong arithmetic. It reasoned from a euclidean distance — 600 m of tail, at
 * which `FogExp2` at the thinnest density the biomes then asked for
 * (0.0038 * 0.9) left under 2% of contrast. But `RoadPath` winds hard enough
 * to double back on itself, so 600 m *along the arc* is 250-350 m from the eye,
 * and lengthening the tail moves that number around at random rather than
 * pushing it away: across seven start positions the nearest framed cut sat at
 * 244-558 m for every tail from 6 to 27 chunks, with no trend. Raycast against
 * the live chunk meshes, the cut was directly visible in every one of 191
 * framed samples at ten chunks, nearest 267 m.
 *
 * What hides it is the land in between: past roughly 800 m of tail, a rolling
 * height field over a winding road usually has a crest in the way. What that
 * buys is *distance*, and distance is the one thing the offline sweep in
 * `menuCamera.test.ts` measures dependably. The nearest exposed point of the
 * cut moves 169 m -> 460 m -> 705 m as the tail goes three -> ten -> fourteen
 * chunks, and then stops moving: 705 m at fourteen, 737 at sixteen, 765 at
 * eighteen, 688 at twenty-two — not even monotonic. Its exposure *rate*
 * separates them no better (0.37, 0.20, 0.26, 0.12 of framed samples). Any tail
 * from fourteen up is the same tail to that instrument, which over-reports
 * exposure besides. Raycast live against the real meshes the cut closed
 * entirely at eighteen and twenty-two, but those rows are single runs of very
 * unequal length and are worth only their shape (§5.3).
 *
 * So the measurement rules out three and ten, and cannot choose within
 * fourteen-to-twenty-two. Twenty-two is a design choice laid on top of that:
 * it puts the tail at 1320 m, which is `AHEAD * CHUNK_LEN`, so the ribbon's
 * rear cut ends exactly as far out as its forward cut. One distance describes
 * both ends of the world, the same haze covers both, and the same `farLand.ts`
 * backdrop meets both — with eight chunks of margin over the shortest tail the
 * sweep cannot tell it from.
 *
 * Haze is not the backstop for what the sweep still reports exposed. That sits
 * around 690 m, where the thinnest biome (`FOG_BASE_DENSITY` * `mist` 0.9)
 * leaves 47% of the cut's contrast; the haze only reaches 6.3% at the 1320 m
 * the tail itself ends at, and that is the *forward* cut's distance, not this
 * one. At 690 m the occluding terrain is the whole mechanism.
 *
 * The cost — nineteen chunks of terrain, road and scenery over the driving
 * budget — is paid only while the menu is up. `menuCamera.test.ts` holds the
 * two numbers together.
 */
export const MENU_BEHIND = AHEAD;

/**
 * Chunks of dense ground cover retained behind the car's own chunk. One is
 * enough: the chase camera sits ~8 m back, so the only grass ever framed
 * behind the car is on the chunk it is currently leaving. How far the band
 * reaches *ahead* is the grass field's own per-quality number (`GrassTier`).
 *
 * Note what that argument is really about. It is a statement about the *eye*,
 * and it holds only because in play the eye rides the car. When something else
 * is holding the camera the band has to follow that instead — see `CoverEye`
 * and `coverBand`, which is where the menu director's vantage enters.
 */
export const GRASS_BEHIND = 1;

/**
 * Where the world is being *looked at* from, in road coordinates.
 *
 * Ground cover is a band around the camera, not around the car; driving, that
 * distinction is free, because the chase camera trails the car by ~8 m and the
 * two bands are the same band. Attract mode is where they come apart.
 * `menuCamera`'s `roadsideStatic` stands as much as `MENU_MAX_LEAD` = 260 m
 * ahead of the car and watches it approach down a 26 degree lens, and a band
 * centred on the car ends `(ahead + 1)` to `(ahead + 2)` chunks in front of it
 * — 180-240 m at `high`, 120-180 m at `low`. So the eye stood on bare ground
 * with a hard cover edge across the middle distance while the car it was
 * pointed at sat in grass (docs/ARCHITECTURE.md §5.7).
 *
 * Passed as a value rather than left as an assumption restated in two
 * docblocks: the manager cannot know which rig is holding the camera, and the
 * director must not have to know how cover is banded.
 */
export interface CoverEye {
  /** Path distance of the eye along the road curve, in metres. */
  readonly s: number;
}

/** Inclusive span of chunk indices that must carry ground cover. */
export interface CoverBand {
  /** First chunk in the band. */
  lo: number;
  /** Last chunk in the band, inclusive. */
  hi: number;
}

/**
 * The chunks ground cover is built for: the car's band, unioned with the eye's
 * whenever something other than the chase camera is looking (`CoverEye`).
 *
 * The car's band is asymmetric — `GRASS_BEHIND` behind, the tier's `ahead` in
 * front — because the rig that rides the car looks forward down the road. A
 * cinematic eye has no such privileged direction: `craneReveal` rises ahead of
 * the car and aims its look target 42 m *behind* it, and `overtake` opens 48 m
 * back and drives past. So the eye carries the tier's reach on both sides of
 * itself, and the rear cover edge lands `ahead` to `ahead + 1` chunks behind it
 * — 120-180 m at `low`, 180-240 m at `medium` and `high`, at or past the ~150 m
 * where a blade stops resolving.
 *
 * The result is one contiguous span rather than two, which is required and not
 * merely convenient: from the `roadsideStatic` vantage the whole stretch of
 * road between the eye and the car is in frame, and most of it is nearer to
 * the lens than the car is.
 *
 * Pure, and writes into `out` so the frame loop allocates nothing.
 */
export function coverBand(
  carS: number,
  eye: CoverEye | null,
  ahead: number,
  out: CoverBand,
): CoverBand {
  const cur = Math.floor(carS / CHUNK_LEN);
  out.lo = cur - GRASS_BEHIND;
  out.hi = cur + ahead;
  if (eye) {
    const eyeCur = Math.floor(eye.s / CHUNK_LEN);
    if (eyeCur - ahead < out.lo) out.lo = eyeCur - ahead;
    if (eyeCur + ahead > out.hi) out.hi = eyeCur + ahead;
  }
  return out;
}

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
  /** Instanced ground cover, present only inside the near grass band. */
  grass: THREE.InstancedMesh | null;
  /**
   * `GrassField.revision` the mesh in `grass` was built under, or -1 when the
   * chunk carries none. Typed and held here rather than stamped on the mesh's
   * `userData` (which is `Record<string, any>` and would let a renamed or
   * dropped stamp read `undefined` forever — rebuilding every band chunk every
   * frame with nothing to catch it).
   */
  grassRev: number;
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
 * Metres each terrain-skirt vertex drops straight down from the boundary
 * vertex it hangs under.
 *
 * The skirt exists because the ribbon is swept in path space and simply ends
 * at its mesh boundaries — laterally at ±165 m (`TER_COLS`) and at the band's
 * two s-ends — while `RoadPath` doubles back on itself constantly: over 60 km
 * of the shipping seed there are ~406k sample pairs more than 800 m apart
 * along the arc but under 600 m apart in a straight line. Seen across such a
 * gap, an open cut edge (elevated by road-elevation drift plus `landHeight`'s
 * far-field rise) hangs in the air with sky or backdrop haze beneath it — the
 * attract-mode "floating terrain" band (issue #88, docs/ARCHITECTURE.md §5.3).
 *
 * The drop is sized so the skirt bottom lands below the ground under any
 * menu-legal eye, so no sky or backdrop can show directly beneath a terrain
 * edge. Three components, summed:
 *
 * - Road-elevation gain between euclid-visible gap pairs (arc > 250 m,
 *   euclid < 1000 m): measured at 125.3 m over a 200 km sweep of the shipping
 *   seed, and bounded analytically by the slope closed form —
 *   2 * sum(amp / freq) = 2 * (0.028/0.0021 + 0.035/0.00072 + 0.008/0.0058)
 *   ~ 126.6 m.
 * - `landHeight`'s maximum relief above its own road (bounded ~36 m: hills
 *   ±23 x 0.55 plus a far-field rise of up to 24; measured 33.4 m).
 * - The viewer's own ground dipping below their road (measured 14.8 m).
 *
 * Plus margin. The skirt-sizing test in `chunks.test.ts` re-measures all three
 * empirically, so retuning the road's slope or the land relief forces this
 * constant to follow.
 */
export const TER_SKIRT_DROP = 180;

/**
 * Drops, in metres below the boundary vertex, of each skirt level — level 0 is
 * the duplicated boundary top, the last level carries the `TER_SKIRT_DROP`
 * closure guarantee unchanged.
 *
 * More than two levels exist because a wall drawn as one 180 m quad reads as a
 * giant featureless cliff: vertex colours and toon shading interpolate over
 * the full 180 m, so the ~40 m strip actually visible above a far lobe's
 * horizon shows essentially uniform colour, and no tint or normal trick can
 * paint detail where there are no vertices (verified live — see issue #88).
 * The resolution is deliberately concentrated near the top, where the wall is
 * seen; the deep levels only exist to reach the closure depth.
 */
export const TER_SKIRT_LEVELS = [0, 6, 16, 36, 80, TER_SKIRT_DROP];

/**
 * Horizontal outward push, in metres, of each skirt level, so the top edge
 * rounds over into a shoulder instead of reading as a knife line against the
 * sky. Aligned with `TER_SKIRT_LEVELS`.
 *
 * The 10 m maximum is safe against self-intersection twice over: doubled-back
 * road lobes already interpenetrate (measured centreline pairs approach ~1 m
 * apart on the shipping seed), so a 10 m flare adds no new overlap class, and
 * on the inside of the tightest bend the fold-limited edge sits at 0.85 x
 * 87.7 = 74.5 m from the road centreline, 13.2 m short of the fold point at
 * the 87.7 m disc centre — 10 m of push still leaves 3.2 m, so no wall band
 * can invert.
 */
export const TER_SKIRT_BEVEL = [0, 4, 7, 9, 10, 10];

/**
 * Per-level multiplier on the boundary vertex's own colour, darkening the wall
 * with depth so it reads as ground falling into shadow rather than a lit
 * cliff. Aligned with `TER_SKIRT_LEVELS`; level 0's ramp stays at 1, so the
 * wall top meets the surface within the wobble alone (the wobble applies at
 * every level, so the crest can differ from its source tone by up to +-7% —
 * the same amplitude as the surface's own patchwork, so the join reads as
 * more patchwork). On top of this ramp each skirt vertex
 * carries the terrain's usual +-7% noise wobble (see `buildTerrain`), keyed on
 * world position and drop so the patchwork is seamless across wall joins and
 * chunk seams.
 */
export const TER_SKIRT_SHADE = [1, 0.95, 0.88, 0.8, 0.7, 0.62];

/** Floats `terrainRow` writes per column: world x, y, z, then effective lat. */
export const TERRAIN_ROW_STRIDE = 4;

const rowP = new THREE.Vector3();
/** One row of `terrainRow` output, reused by every terrain build. */
let terrainScratch = new Float64Array(16 * TERRAIN_ROW_STRIDE);

/**
 * One row of terrain grid vertices at path distance `s`, written into `out` at
 * `offset` as `TERRAIN_ROW_STRIDE` floats per `TER_COLS` column: world x, y, z
 * and the *effective* lateral that column landed at once the far-field
 * compression has had its say.
 *
 * `buildTerrain` fills its own vertex buffer from this, so anything else that
 * needs the surface the renderer draws — `world/grass.ts` scatters inside these
 * cells — walks the identical grid by construction rather than by agreement
 * (docs/ARCHITECTURE.md §5.3).
 */
export function terrainRow(path: RoadPath, s: number, out: Float64Array, offset = 0): void {
  const roadY = path.elevation(s);
  const kappa = path.curvature(s);
  for (let j = 0; j < TER_COLS.length; j++) {
    const lat = foldSafeLateral(kappa, TER_COLS[j]);
    path.pointAtEffective(s, lat, rowP);
    const k = offset + j * TERRAIN_ROW_STRIDE;
    out[k] = rowP.x;
    out[k + 1] = landHeight(roadY, s, lat);
    out[k + 2] = rowP.z;
    out[k + 3] = lat;
  }
}

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
 *
 * The height is taken at the *effective* lateral — where `RoadPath.point`
 * actually puts that column once the far-field compression has had its say —
 * so the land keeps its features the size of the ground they sit on rather
 * than piling a 165 m far-field rise onto a column that landed at 80 m.
 */
export function terrainHeight(path: RoadPath, s: number, lat: number): number {
  return landHeight(path.elevation(s), s, path.effectiveLateral(s, lat));
}

/** A point on the terrain as it is actually rendered. */
export interface TerrainSample {
  /** World-space height of the drawn surface (absolute, not chunk-local). */
  y: number;
  /** Unit face normal of the triangle under the point, always pointing up. */
  normal: THREE.Vector3;
}

/** Allocate a reusable `TerrainSample` — sampling itself allocates nothing. */
export function createTerrainSample(): TerrainSample {
  return { y: 0, normal: new THREE.Vector3(0, 1, 0) };
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
  // Each row compresses its own far columns by its own curvature, exactly as
  // buildTerrain does, so the cell walked here is the cell that was drawn.
  // One curvature per row, not one per corner: this runs per prop.
  const kLo = path.curvature(s0);
  const kHi = path.curvature(s1);
  fillCorner(0, poseLo, s0, foldSafeLateral(kLo, l0));
  fillCorner(1, poseLo, s0, foldSafeLateral(kLo, l1));
  fillCorner(2, poseHi, s1, foldSafeLateral(kHi, l0));
  fillCorner(3, poseHi, s1, foldSafeLateral(kHi, l1));
  // The query rides the curve *between* the two rows, so it needs the
  // curvature at s and cannot borrow either row's. Three per sample is the
  // floor here, not an oversight.
  path.pointAtEffective(s, foldSafeLateral(path.curvature(s), l), queryP);

  // gridIndices emits (a,b,c) then (b,d,c), so the cell's diagonal runs from
  // the near row's far column to the far row's near column. Splitting the
  // other way leaves props off by the whole diagonal error.
  if (triangleAt(0, 1, 2, queryP.x, queryP.z, out)) return out;
  if (triangleAt(1, 3, 2, queryP.x, queryP.z, out)) return out;

  // The cell is planar in XZ while the query point rides the curve between the
  // two rows, so a point a hair outside both triangles is possible on the
  // sharpest cells. Fall back to the parametric split rather than return
  // nothing. (Measured across 102 km this is now zero — see §5.3.)
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

/** One cell corner. `lat` is the *effective* lateral, already compressed. */
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
    return;
  }
  out.normal.divideScalar(len);
  // The lateral map can no longer invert (RoadPath.foldSafeLateral), so a cell
  // always winds the same way and the normal always comes out up. The flip is
  // kept as a floor under floating-point noise on a near-degenerate cell, not
  // as a fold workaround: there is nothing left to flag.
  if (out.normal.y < 0) out.normal.negate();
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
 * land tops out near 26°; the cap is what keeps a prop upright on the steepest
 * cell the height field can produce instead of laying it down.
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
  const follow = SLOPE_FOLLOW[kind];
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
  private behindChunks = PLAY_BEHIND;
  /** Reused by `updateCover` so the frame loop allocates nothing (§14). */
  private readonly band: CoverBand = { lo: 0, hi: 0 };
  private mat = vertexToonMat();
  readonly root = new THREE.Group();

  constructor(
    private path: RoadPath,
    private scene: THREE.Scene,
    /**
     * Dense ground cover, or omitted when a caller wants bare chunks (the
     * tests do). The field owns the proto, the material and the wind; the
     * manager owns only *which* chunks currently carry it, because grass lives
     * on the chunk group and inherits its rebase/cull/dispose lifecycle
     * (docs/ARCHITECTURE.md §5.7).
     */
    private grass: GrassField | null = null,
  ) {
    scene.add(this.root);
  }

  /**
   * Chunks kept behind the car right now — `PLAY_BEHIND` or `MENU_BEHIND`.
   * Read by callers that have to keep road samples alive for them
   * (`main.ts`'s reseed margin).
   */
  get behind(): number {
    return this.behindChunks;
  }

  /**
   * Set how far the ribbon reaches behind the car. Takes effect on the next
   * `update()`: growing it builds the new chunks there, shrinking it recycles
   * them, so callers that re-seed the world anyway pay nothing extra.
   */
  setBehind(count: number): void {
    this.behindChunks = Math.max(PLAY_BEHIND, Math.round(count));
  }

  /**
   * Build the ribbon for this frame: chunks in `[cur - behind, cur + AHEAD]`
   * in, everything outside it disposed.
   *
   * Ground cover is **not** built here — `updateCover` is a separate pass, run
   * later in the frame, and every caller of this owes a call to it. The split
   * is an ordering constraint, not a tidy-up: this has to run *before* the
   * camera, because the menu director samples the terrain these chunks own to
   * pick and clear its vantage, while cover has to run *after* it, because
   * cover is banded around wherever the camera ended up (see `updateCover`).
   */
  update(carS: number): void {
    const cur = Math.floor(carS / CHUNK_LEN);
    const behind = this.behindChunks;
    for (let i = cur - behind; i <= cur + AHEAD; i++) {
      if (i >= 0 && !this.chunks.has(i)) this.buildChunk(i);
    }
    for (const [idx, chunk] of this.chunks) {
      if (idx < cur - behind || idx > cur + AHEAD) {
        this.root.remove(chunk.group);
        this.dropGrass(chunk);
        for (const g of chunk.geos) g.dispose();
        this.chunks.delete(idx);
      }
    }
    this.path.prune(carS - behind * CHUNK_LEN - 100);
  }

  /**
   * Add and remove ground cover so it covers only the near band around
   * whatever is looking at the world — the car, unioned with `eye` when
   * something other than the chase camera is holding the frame (`coverBand`).
   * Pass `null` for play. Grass is invisible past ~150 m, so building it for
   * all `AHEAD` chunks would pay 22 chunks of instance data for four chunks of
   * benefit — and the per-frame cost of a chunk boundary is the whole budget
   * here (§5.3, §14).
   *
   * **Run this after the camera has been placed for the frame, not before.**
   * That is the whole reason it is not part of `update`: the band has to be
   * resolved against the vantage the frame is actually rendered from. Resolved
   * a step too early it lags the eye by a frame, which nobody can see while the
   * eye is walking — but a menu cut moves it up to `MENU_MAX_LEAD` in one step,
   * and that frame renders a fresh vantage standing on bare ground. `main.ts`
   * calls this straight after the camera block and `update` well before it;
   * both call sites say so.
   *
   * Only chunks the ribbon is currently holding can be covered, so `carS` must
   * be the one `update` was given this frame.
   *
   * At most one chunk is built per call in steady driving, in either mode: the
   * band slides one chunk at a time whether the car or the eye is what moved.
   * A menu *cut* is the deliberate exception — it builds every chunk the jump
   * uncovered at once, a handful of chunk boundaries paid on the one frame
   * where the whole image changes anyway.
   */
  updateCover(carS: number, eye: CoverEye | null): void {
    const field = this.grass;
    if (!field) return;
    const { lo, hi } = coverBand(carS, eye, field.ahead, this.band);
    for (const [idx, chunk] of this.chunks) {
      const wanted = idx >= lo && idx <= hi;
      if (wanted && chunk.grass && chunk.grassRev !== field.revision) {
        // Quality changed under this chunk: drop it and rebuild below.
        this.dropGrass(chunk);
      }
      if (wanted && !chunk.grass) {
        const mesh = field.build(this.path, idx, chunk.group.position);
        if (mesh) {
          // Stamped so the band a mesh belongs to is readable without
          // reconstructing it from the group's place in the child list.
          mesh.userData.chunkIndex = idx;
          chunk.group.add(mesh);
          chunk.grass = mesh;
          chunk.grassRev = field.revision;
        }
      } else if (!wanted && chunk.grass) {
        this.dropGrass(chunk);
      }
    }
  }

  /** Detach and release one chunk's grass. The proto/material are shared. */
  private dropGrass(chunk: Chunk): void {
    if (!chunk.grass) return;
    chunk.group.remove(chunk.grass);
    chunk.grass.geometry.dispose();
    chunk.grass.dispose();
    chunk.grass = null;
    chunk.grassRev = -1;
  }

  /**
   * Dispose every live chunk. Called when the car teleports along the path and
   * the road is re-seeded (RoadPath.reset), after which cached chunk geometry
   * no longer matches the curve it was built from.
   */
  reset(): void {
    for (const chunk of this.chunks.values()) {
      this.root.remove(chunk.group);
      this.dropGrass(chunk);
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
    this.chunks.set(index, { index, group, obstacles, geos, grass: null, grassRev: -1 });
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
      // One curvature per row rather than one per column. The road never gets
      // near the fold — |k| <= 1/87.7 and ROAD_COLS stops at 5.5 m — but going
      // through foldSafeLateral rather than assuming that keeps this correct
      // if the cross-section ever widens.
      const kappa = this.path.curvature(s);
      const dashOn = Math.floor(s / 4) % 2 === 0;
      for (let j = 0; j < cols; j++) {
        this.path.pointAtEffective(s, foldSafeLateral(kappa, ROAD_COLS[j]), p);
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
    const surf = rows * cols;
    // Perimeter skirt: closes the ribbon's open cut edges against the
    // doubled-back-road sightlines of issue #88 (docs/ARCHITECTURE.md §5.3).
    // The surface occupies the buffer prefix exactly as it did without it.
    const skirt = cachedTerrainSkirt(rows, cols);
    const pos = new Float32Array((surf + skirt.src.length) * 3);
    const col = new Float32Array((surf + skirt.src.length) * 3);
    const ground = new THREE.Color();
    const groundAlt = new THREE.Color();
    const mixed = new THREE.Color();
    if (terrainScratch.length < cols * TERRAIN_ROW_STRIDE) {
      terrainScratch = new Float64Array(cols * TERRAIN_ROW_STRIDE);
    }

    for (let r = 0; r < rows; r++) {
      const s = s0 + r * TER_ROW_STEP;
      blendColor(s, (b) => b.ground, ground);
      blendColor(s, (b) => b.groundAlt, groundAlt);
      // The one place the drawn surface is defined. grass.ts walks the same
      // rows, so its clusters cannot drift off the triangles drawn here.
      terrainRow(this.path, s, terrainScratch);
      for (let j = 0; j < cols; j++) {
        // Where this column actually lands once the far field has been
        // compressed away from the fold. Height and colour both key off it, so
        // the land reads at the size of the ground it covers.
        const g = j * TERRAIN_ROW_STRIDE;
        const lat = terrainScratch[g + 3];
        const k = (r * cols + j) * 3;
        pos[k] = terrainScratch[g] - anchor.x;
        pos[k + 1] = terrainScratch[g + 1];
        pos[k + 2] = terrainScratch[g + 2] - anchor.z;
        // Color: noise blend between ground tones + gentle brightness wobble.
        const t = noise2(s * 0.02 + 7, lat * 0.03) * 0.5 + 0.5;
        mixed.copy(ground).lerp(groundAlt, t);
        const v = 1 + noise2(s * 0.09, lat * 0.11 + 3) * 0.07;
        col[k] = mixed.r * v;
        col[k + 1] = mixed.g * v;
        col[k + 2] = mixed.b * v;
      }
    }

    // Skirt vertices: duplicate each boundary vertex (never share it — see
    // `terrainSkirt`), then place each level down by its drop and out by its
    // bevel along the vertex's one shared outward direction (watertight at
    // corners by construction). Colour is the boundary vertex's own tone
    // through the depth ramp, plus the surface's usual noise wobble — keyed on
    // world position and drop so the patchwork is seamless across wall joins
    // and chunk seams, and baked like all terrain colour.
    const outward = { x: 0, z: 0 };
    for (let i = 0; i < skirt.src.length; i++) {
      const a = skirt.src[i] * 3;
      const b = (surf + i) * 3;
      const l = skirt.level[i];
      perimeterOutward(pos, rows, cols, skirt.src[i], outward);
      pos[b] = pos[a] + outward.x * TER_SKIRT_BEVEL[l];
      pos[b + 1] = pos[a + 1] - TER_SKIRT_LEVELS[l];
      pos[b + 2] = pos[a + 2] + outward.z * TER_SKIRT_BEVEL[l];
      const wobble =
        1 +
        noise2(
          (pos[b] + anchor.x) * 0.02,
          (pos[b + 2] + anchor.z) * 0.02 + TER_SKIRT_LEVELS[l] * 0.13,
        ) *
          0.07;
      const shade = TER_SKIRT_SHADE[l] * wobble;
      col[b] = col[a] * shade;
      col[b + 1] = col[a + 1] * shade;
      col[b + 2] = col[a + 2] * shade;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const grid = gridIndices(rows, cols);
    const idx = new Uint32Array(grid.count + skirt.indices.length);
    idx.set(grid.array as Uint32Array);
    idx.set(skirt.indices, grid.count);
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    // Overwrite every skirt normal with its surface source's, so the walls
    // shade exactly like the ground they hang from — no dark cliff faces at
    // glancing sun angles (`farLand.ts` leans normals up for the same reason).
    const nrm = geo.getAttribute('normal').array as Float32Array;
    for (let i = 0; i < skirt.src.length; i++) {
      const a = skirt.src[i] * 3;
      const b = (surf + i) * 3;
      nrm[b] = nrm[a];
      nrm[b + 1] = nrm[a + 1];
      nrm[b + 2] = nrm[a + 2];
    }
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

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const vec = new THREE.Vector3();
    const nrm = new THREE.Vector3();
    const nm = new THREE.Matrix3();
    const tint = new THREE.Color();
    const worldP = new THREE.Vector3();

    // ---- pass 1: place. Props arrive in seeded clumps rather than one at a
    // time — a grove of four oaks and a clearing reads several times denser
    // than the same four oaks sprinkled evenly (docs/ARCHITECTURE.md §5.7).
    ensurePlacements(count);
    const place = placements;
    place.kind.length = 0;
    place.n = 0;
    let vertexTotal = 0;
    let clumpLeft = 0;
    let clumpKind: SceneryKind = 'grassTuft';
    let clumpS = s0;
    let clumpLat = 0;
    let clumpSide = 1;
    let clumpSpread = 0;
    let clumpLatSpread = 0;

    for (let i = 0; i < count; i++) {
      if (clumpLeft <= 0) {
        const u = r();
        clumpKind = pickScenery(s0 + u * CHUNK_LEN, r());
        clumpSide = r() < 0.5 ? -1 : 1;
        clumpLat = clumpSide * latBandFor(clumpKind, r);
        const rule = CLUMP[clumpKind];
        clumpSpread = rule.spread;
        clumpLatSpread = rule.spread * rule.lateral;
        // Anchors are inset by the run's own reach, so every member of a clump
        // lands inside this chunk and nothing straddles a seam.
        clumpS = s0 + clumpSpread + u * (CHUNK_LEN - 2 * clumpSpread);
        clumpLeft = rule.min + Math.floor(r() * (rule.max - rule.min + 1));
      }
      clumpLeft--;
      const kind = clumpKind;
      const s = clumpSpread > 0 ? clumpS + (r() - 0.5) * 2 * clumpSpread : clumpS;
      // Members stay on their clump's side of the road and off the shoulder.
      const lat =
        clumpLatSpread > 0
          ? clumpSide * Math.max(6, Math.abs(clumpLat) + (r() - 0.5) * 2 * clumpLatSpread)
          : clumpLat;

      let scale =
        kind === 'windmill'
          ? 0.9 + r() * 0.4
          : kind === 'rock'
            ? 0.6 + r() * 1.1
            : 0.75 + r() * 0.6;
      // Keep trees hugging the road smaller so canopies never swallow the camera.
      if (TREE_KINDS.has(kind) && Math.abs(lat) < 17) scale = Math.min(scale, 0.9);

      // Rows and fences align with the road; everything else spins freely.
      const heading = this.path.heading(s);
      const yaw =
        kind === 'fence' || kind === 'lavenderRow' || kind === 'sunflowerPatch'
          ? heading + Math.PI / 2 + (r() - 0.5) * 0.15
          : r() * Math.PI * 2;

      // Instance tint: canopy/flower/rock palette blended at s. Drawn here so
      // the seeded stream is consumed in placement order, not bake order.
      pickTint(s, kind, r, tint);

      const k = place.n;
      place.kind.push(kind);
      place.s[k] = s;
      place.lat[k] = lat;
      place.scale[k] = scale;
      place.yaw[k] = yaw;
      place.tint[k * 3] = tint.r;
      place.tint[k * 3 + 1] = tint.g;
      place.tint[k * 3 + 2] = tint.b;
      place.n++;
      vertexTotal += getProto(kind).vertexCount;

      // Near-shoulder solid objects become near-miss targets.
      if ((kind === 'hay' || kind === 'rock' || kind === 'fence') && Math.abs(lat) < 10) {
        const radius = getProto(kind).radius;
        obstacles.push({ s, lateral: lat, radius: radius * scale, key: `${index}:${i}` });
      }
    }

    if (!vertexTotal) return null;

    // ---- pass 2: bake. The buffers are sized up front from the pass-1 vertex
    // total; growing three `number[]`s by ~150k pushes was the bulk of this
    // method's cost before the density went up (§5.3's build-spike budget).
    const posOut = new Float32Array(vertexTotal * 3);
    const normOut = new Float32Array(vertexTotal * 3);
    const colOut = new Float32Array(vertexTotal * 3);
    let w = 0;

    for (let i = 0; i < place.n; i++) {
      const kind = place.kind[i];
      const proto = getProto(kind);
      const s = place.s[i];
      const lat = place.lat[i];
      const yaw = place.yaw[i];

      this.path.point(s, lat, worldP);
      // Ground to the terrain as drawn, not to the height field the mesh only
      // samples at its grid vertices — between them they differ by metres.
      const y = groundProp(this.path, s, lat, kind, yaw, q);

      m.compose(
        vec.set(worldP.x - anchor.x, y, worldP.z - anchor.z),
        q,
        tmpScale.setScalar(place.scale[i]),
      );
      nm.getNormalMatrix(m);
      const tr = place.tint[i * 3];
      const tg = place.tint[i * 3 + 1];
      const tb = place.tint[i * 3 + 2];

      const { pos, norm, baked, shade, mask, vertexCount } = proto;
      for (let vI = 0; vI < vertexCount; vI++) {
        vec.set(pos[vI * 3], pos[vI * 3 + 1], pos[vI * 3 + 2]).applyMatrix4(m);
        nrm
          .set(norm[vI * 3], norm[vI * 3 + 1], norm[vI * 3 + 2])
          .applyMatrix3(nm)
          .normalize();
        posOut[w] = vec.x;
        normOut[w] = nrm.x;
        posOut[w + 1] = vec.y;
        normOut[w + 1] = nrm.y;
        posOut[w + 2] = vec.z;
        normOut[w + 2] = nrm.z;
        const sh = shade[vI];
        if (mask[vI] > 0.5) {
          colOut[w] = tr * sh;
          colOut[w + 1] = tg * sh;
          colOut[w + 2] = tb * sh;
        } else {
          colOut[w] = baked[vI * 3] * sh;
          colOut[w + 1] = baked[vI * 3 + 1] * sh;
          colOut[w + 2] = baked[vI * 3 + 2] * sh;
        }
        w += 3;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(posOut, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normOut, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colOut, 3));
    const mesh = new THREE.Mesh(geo, this.mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }
}

const tmpScale = new THREE.Vector3();

/** Kinds that get the near-road canopy clamp. */
const TREE_KINDS = new Set<SceneryKind>(['oak', 'maple', 'pine', 'poplar', 'cherryTree']);

/** How props of one kind gather into a run. */
interface ClumpRule {
  /** Fewest / most props emitted from a single clump anchor. */
  min: number;
  max: number;
  /** Scatter of the run along s, in meters either side of the anchor. */
  spread: number;
  /** Lateral scatter as a fraction of `spread` — rows stay narrow. */
  lateral: number;
}

/**
 * Clumping table. Scenery is emitted in seeded runs rather than as independent
 * placements: at the same count, groves and drifts read several times denser
 * than an even sprinkle, and the gaps between them are what make the density
 * legible as landscape (docs/ARCHITECTURE.md §5.7).
 *
 * `spread` stays well under `CHUNK_LEN / 2` because a clump anchor is inset by
 * its own reach so no run crosses a chunk seam.
 */
const CLUMP: Record<SceneryKind, ClumpRule> = {
  oak: { min: 1, max: 4, spread: 7, lateral: 0.9 },
  maple: { min: 1, max: 4, spread: 7, lateral: 0.9 },
  pine: { min: 2, max: 5, spread: 7.5, lateral: 0.9 },
  poplar: { min: 1, max: 3, spread: 6, lateral: 0.8 },
  cherryTree: { min: 1, max: 4, spread: 7, lateral: 0.9 },
  rock: { min: 1, max: 3, spread: 2.6, lateral: 1 },
  flowers: { min: 3, max: 8, spread: 4.5, lateral: 1 },
  grassTuft: { min: 2, max: 5, spread: 3.4, lateral: 1 },
  hay: { min: 1, max: 3, spread: 5, lateral: 0.4 },
  fence: { min: 1, max: 3, spread: 4.6, lateral: 0.15 },
  windmill: { min: 1, max: 1, spread: 0, lateral: 0 },
  sunflowerPatch: { min: 2, max: 5, spread: 5, lateral: 0.5 },
  lavenderRow: { min: 2, max: 5, spread: 5, lateral: 0.5 },
  reeds: { min: 2, max: 6, spread: 4.2, lateral: 1 },
};

/**
 * Lateral offset magnitude for a clump anchor of `kind`, in meters from the
 * centerline. Flowers reach much further than the rest — the old 6.5 + 40 m
 * band left everything past the near field bare — with a power bias that keeps
 * the shoulder dense while the tail carries colour into the mid field.
 */
function latBandFor(kind: SceneryKind, r: () => number): number {
  switch (kind) {
    case 'fence':
    case 'hay':
      return 6.8 + r() * 6;
    case 'windmill':
      return 45 + r() * 90;
    case 'sunflowerPatch':
    case 'lavenderRow':
      return 9 + r() * 55;
    case 'flowers':
      return 6.5 + Math.pow(r(), 1.4) * 104;
    case 'grassTuft':
      return 6.5 + r() * 44;
    default:
      return 10.5 + r() * 128;
  }
}

/**
 * Pass-1 placement buffer for `buildScenery`, reused across chunk builds so a
 * build allocates only the two vertex buffers it hands to three.js.
 */
interface PlacementBuf {
  n: number;
  kind: SceneryKind[];
  s: Float64Array;
  lat: Float64Array;
  scale: Float64Array;
  yaw: Float64Array;
  tint: Float32Array;
}

function createPlacements(cap: number): PlacementBuf {
  return {
    n: 0,
    kind: [],
    s: new Float64Array(cap),
    lat: new Float64Array(cap),
    scale: new Float64Array(cap),
    yaw: new Float64Array(cap),
    tint: new Float32Array(cap * 3),
  };
}

let placements = createPlacements(256);

/** Grow the placement buffer if this chunk's prop count outruns it. */
function ensurePlacements(count: number): void {
  if (count > placements.s.length) placements = createPlacements(count * 2);
}

/**
 * pickTint holds its sample across the `r()` draws below, so it owns one
 * rather than reading the module-level scratch `biomeAt` hands back by
 * default — anything else called in between would clobber it underneath us.
 */
const tintSample = createBiomeSample();

function pickTint(s: number, kind: SceneryKind, r: () => number, out: THREE.Color): void {
  const sample = biomeAt(s, tintSample);
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

/**
 * Topology of the perimeter skirt one terrain grid hangs below itself:
 * which surface vertex each appended skirt vertex copies, whether it is a
 * dropped bottom, and the wall triangles over the combined buffer.
 *
 * Pure grid arithmetic — positions never enter — so `buildTerrain` computes it
 * once per grid shape (see `cachedTerrainSkirt`) and the contract is testable
 * without a scene (docs/ARCHITECTURE.md §5.3).
 */
export interface TerrainSkirt {
  /**
   * Surface vertex index each skirt vertex hangs from. Skirt vertex `i` lives
   * at buffer index `rows * cols + i`, derives its position, colour and — after
   * `computeVertexNormals` — its normal from its source, so the walls shade
   * like the ground above them.
   */
  src: Uint32Array;
  /**
   * Index into `TER_SKIRT_LEVELS` / `TER_SKIRT_BEVEL` / `TER_SKIRT_SHADE` for
   * each skirt vertex: 0 is the duplicated boundary top, the last level hangs
   * `TER_SKIRT_DROP` below it.
   */
  level: Uint8Array;
  /** Wall triangles, indexed over the combined surface-then-skirt buffer. */
  indices: Uint32Array;
}

/**
 * Build the skirt for a `rows` x `cols` terrain grid: a wall hanging from the
 * grid's entire perimeter — both lateral edge columns and both end rows — so a
 * cut edge seen across a doubled-back gap shows ground under it instead of
 * sky (issue #88, docs/ARCHITECTURE.md §5.3).
 *
 * Each wall is a stack of `TER_SKIRT_LEVELS` rings rather than one tall quad:
 * one quad from top to bottom interpolates its colours over the full 180 m, so
 * the strip actually visible above a far lobe's horizon reads as a single
 * featureless tone. The levels give the wall the vertical resolution to carry
 * the depth ramp and patchwork `buildTerrain` paints on it, and the bevel
 * (`TER_SKIRT_BEVEL`) rounds the top edge over into a shoulder.
 *
 * Boundary tops are duplicated rather than shared with the surface grid:
 * sharing would let `computeVertexNormals` tilt the boundary-row surface
 * normals outward, and at internal chunk seams — where the wall hangs buried
 * under the neighbour's continuous ground — that would stamp a toon-band
 * shading line across every 60 m boundary.
 *
 * The walls wind to face *outward* (the material is front-side only), so
 * backface culling hides every wall from inside the ribbon and the near-field
 * look is untouched by construction. Both walls at each grid corner carry the
 * corner at every level, and `perimeterOutward` gives the corner one shared
 * bevel direction, so the perimeter closes watertight.
 */
export function terrainSkirt(rows: number, cols: number): TerrainSkirt {
  const surf = rows * cols;
  const L = TER_SKIRT_LEVELS.length;
  const src = new Uint32Array(L * 2 * (rows + cols));
  const level = new Uint8Array(src.length);
  const indices = new Uint32Array(6 * (L - 1) * (2 * (rows - 1) + 2 * (cols - 1)));
  let v = 0;
  let k = 0;

  // One wall: the boundary run duplicated once per level, then the quads
  // between consecutive levels. The surface grid winds its faces upward, which
  // fixes the frame — lateral x row-step = up — and the two wall windings
  // follow from it: with the upper ring advancing along the run, (upper,
  // next-upper, lower) faces one way and `flip` swaps to the other. Which wall
  // takes which is pinned by the outward-facing test in chunks.test.ts.
  const wall = (n: number, at: (i: number) => number, flip: boolean): void => {
    const base = v;
    for (let l = 0; l < L; l++) {
      for (let i = 0; i < n; i++) {
        src[v] = at(i);
        level[v++] = l;
      }
    }
    for (let l = 0; l < L - 1; l++) {
      for (let i = 0; i < n - 1; i++) {
        const t0 = surf + base + l * n + i;
        const t1 = t0 + 1;
        const b0 = t0 + n;
        const b1 = b0 + 1;
        indices[k++] = t0;
        indices[k++] = flip ? b0 : t1;
        indices[k++] = flip ? t1 : b0;
        indices[k++] = t1;
        indices[k++] = flip ? b0 : b1;
        indices[k++] = flip ? b1 : b0;
      }
    }
  };

  wall(rows, (r) => r * cols, false); // lat TER_COLS[0] edge, faces -lat
  wall(rows, (r) => r * cols + cols - 1, true); // lat TER_COLS[last] edge, faces +lat
  wall(cols, (j) => j, true); // first row, faces backward along the road
  wall(cols, (j) => (rows - 1) * cols + j, false); // last row, faces forward
  return { src, level, indices };
}

/**
 * Unit outward XZ direction of one perimeter vertex of the surface grid,
 * derived from the grid's own drawn positions: for an edge vertex, from its
 * inner neighbour toward it (y ignored); at a grid corner, the normalized sum
 * of its two edge directions.
 *
 * The corner rule is what keeps the bevelled skirt watertight: the two walls
 * meeting at a corner both consume this one direction, so they push the
 * shared corner to *identical* positions at every level rather than each
 * flaring along its own edge and tearing the seam open.
 *
 * `pos` is the surface vertex buffer (anchor-relative is fine — only
 * differences enter). Writes into `out` and allocates nothing.
 */
export function perimeterOutward(
  pos: Float32Array,
  rows: number,
  cols: number,
  srcIdx: number,
  out: { x: number; z: number },
): { x: number; z: number } {
  const r = Math.floor(srcIdx / cols);
  const j = srcIdx % cols;
  let x = 0;
  let z = 0;
  const add = (inner: number): void => {
    const dx = pos[srcIdx * 3] - pos[inner * 3];
    const dz = pos[srcIdx * 3 + 2] - pos[inner * 3 + 2];
    const len = Math.hypot(dx, dz);
    if (len > 0) {
      x += dx / len;
      z += dz / len;
    }
  };
  if (j === 0) add(srcIdx + 1);
  if (j === cols - 1) add(srcIdx - 1);
  if (r === 0) add(srcIdx + cols);
  if (r === rows - 1) add(srcIdx - cols);
  const len = Math.hypot(x, z);
  out.x = len > 0 ? x / len : 0;
  out.z = len > 0 ? z / len : 0;
  return out;
}

/** `terrainSkirt` memoized on grid shape — every chunk shares one topology. */
let skirtCache: { rows: number; cols: number; skirt: TerrainSkirt } | null = null;

function cachedTerrainSkirt(rows: number, cols: number): TerrainSkirt {
  if (!skirtCache || skirtCache.rows !== rows || skirtCache.cols !== cols) {
    skirtCache = { rows, cols, skirt: terrainSkirt(rows, cols) };
  }
  return skirtCache.skirt;
}

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
