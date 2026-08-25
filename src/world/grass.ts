import * as THREE from 'three';
import type { GameSettings } from '../types';
import { RoadPath } from './roadPath';
import {
  CHUNK_LEN,
  TER_COLS,
  TER_ROW_STEP,
  TERRAIN_ROW_STRIDE,
  propOrientation,
  terrainRow,
} from './chunks';
import { blendColor } from './biomes';
import { rng, toonRamp } from './materials';

/**
 * Dense instanced ground cover.
 *
 * Everything else in `world/scenery.ts` rides `ChunkManager.buildScenery`'s
 * merged CPU bake — one `Mesh` per chunk for a few dozen props, which keeps the
 * draw-call count flat (docs/ARCHITECTURE.md §5.7). Grass is the one kind that
 * cannot: it wants thousands of copies of a *single* proto per chunk, which is
 * exactly the shape `InstancedMesh` was built for. Baking 2400 clusters through
 * the merged path would cost a per-vertex CPU transform of ~72k vertices per
 * chunk; instancing costs one 16-float matrix each and still draws in one call.
 *
 * Three constraints shape the rest of the module:
 *
 * - **Near band only.** Grass is invisible past ~150 m, so it is built for a
 *   handful of chunks around the car rather than the whole `AHEAD` window, and
 *   added/removed as the car advances. The per-frame build cost is therefore
 *   one chunk at a chunk boundary, never the window (§5.3, §14).
 * - **Placed on the drawn terrain, by construction.** Rather than scatter in
 *   (s, lat) and sample the surface back — the route `groundProp` takes, at
 *   three `RoadPath.pose` lookups a prop — clusters are scattered *inside* the
 *   terrain mesh's own cells and positioned by barycentric interpolation of the
 *   cell corners. The result lies on the triangle the renderer draws, exactly,
 *   with no per-cluster path sampling at all. Grounding to `terrainHeight`
 *   instead is the "floating trees" bug (§5.3).
 * - **Floating-origin safe.** Each chunk's mesh hangs on that chunk's existing
 *   `THREE.Group`, so `ChunkManager`'s rebase, cull and dispose lifecycle cover
 *   it. Nothing here caches an absolute world position across frames, and the
 *   wind's spatial phase is keyed off `(s, lat)` rather than world XZ so a
 *   rebase cannot shift the gust pattern (§5.2).
 */

type Quality = GameSettings['quality'];

/** Per-quality-tier shape of the grass field. */
export interface GrassTier {
  /** Cluster instances per 60 m chunk. */
  clusters: number;
  /** Blades in one cluster proto. */
  blades: number;
  /** Height segments per blade: 2 bends on a curve, 1 is a straight quad. */
  segments: number;
  /** Chunks of grass built ahead of the car's own chunk. */
  ahead: number;
  /** Whether the travelling-gust term is compiled into the wind shader. */
  ripple: boolean;
  /** Whether blades sample the shadow map. */
  receiveShadow: boolean;
}

/**
 * Density ladder. `high` is the honest "a lot a lot" target — 2400 clusters of
 * five blades per 60 m chunk, ~1.4 clusters/m² on the shoulder. `low` is not
 * merely thinner: it drops a blade and a height segment, loses the ripple term
 * from the shader and the shadow-map fetch from the fragment stage, and carries
 * one chunk fewer, so it is genuinely cheaper the way §5.8 asks the effect
 * stack's `low` to be.
 */
export const GRASS_TIERS: Record<Quality, GrassTier> = {
  low: { clusters: 450, blades: 3, segments: 1, ahead: 2, ripple: false, receiveShadow: false },
  medium: { clusters: 1200, blades: 4, segments: 1, ahead: 3, ripple: true, receiveShadow: true },
  high: { clusters: 2400, blades: 5, segments: 2, ahead: 3, ripple: true, receiveShadow: true },
};

/**
 * Lateral reach, in meters. Past this the blades are a few pixels tall, so the
 * ribbon's remaining ±165 m is left to the terrain sheet. Lands on a
 * `TER_COLS` boundary so no band is cut in half.
 *
 * This used to argue that `FogExp2` "has eaten them anyway", which was true at
 * the old 0.0038 density and is not at the shipped 0.0014 — 75 m is now under
 * 2% fogged, so the cap is carried entirely by apparent size. If the reach ever
 * needs revisiting, that is the argument to weigh, not the fog.
 */
export const GRASS_MAX_LAT = 75;
/**
 * Half-width, in meters, of the road corridor grass never enters. Equal to the
 * `TER_COLS` column just outside the road strip's dirt shoulder (±5.5 m).
 */
export const GRASS_MIN_LAT = 5.9;

/**
 * Lateral falloff scale, in meters — the distance at which the per-m² cluster
 * density has halved. Uniform scatter across the whole ribbon spends almost
 * every blade on ground the chase camera never frames; at 12 m the shoulder
 * carries ~19x the density of the far field.
 */
const LAT_FALLOFF = 12;

/**
 * Relative cluster density per square metre at lateral offset `lat`. Pure, and
 * the only place the near-road bias is expressed — `GRASS_BANDS` integrates it.
 */
export function lateralDensity(lat: number): number {
  const a = Math.abs(lat);
  if (a < GRASS_MIN_LAT || a > GRASS_MAX_LAT) return 0;
  const x = a / LAT_FALLOFF;
  return 1 / (1 + x * x);
}

/** One terrain column pair grass is scattered into. */
export interface GrassBand {
  /** Index of the near column in `TER_COLS`; the band spans j..j+1. */
  j: number;
  /** Cumulative share of all clusters up to and including this band (0..1). */
  cumulative: number;
}

/**
 * The terrain cells grass is allowed into, with a cumulative distribution over
 * them weighted by `lateralDensity` integrated across each band's width.
 *
 * Scattering per *band* rather than per metre of lateral is what lets a cluster
 * be positioned by interpolating four terrain corners instead of re-sampling
 * the path: the band is the cell, so the placement is already on the surface.
 */
export const GRASS_BANDS: GrassBand[] = buildBands();

function buildBands(): GrassBand[] {
  const raw: Array<{ j: number; w: number }> = [];
  let total = 0;
  for (let j = 0; j < TER_COLS.length - 1; j++) {
    const l0 = TER_COLS[j];
    const l1 = TER_COLS[j + 1];
    const mid = (l0 + l1) / 2;
    // A band straddling the road (or reaching past the lateral cap) scores
    // zero through lateralDensity and drops out here.
    const w = lateralDensity(mid) * (l1 - l0);
    if (w <= 0) continue;
    raw.push({ j, w });
    total += w;
  }
  let acc = 0;
  return raw.map(({ j, w }) => {
    acc += w / total;
    return { j, cumulative: acc };
  });
}

/**
 * Index into `GRASS_BANDS` for a uniform roll in [0, 1). Pure; the linear scan
 * is over ten entries and runs once per cluster.
 */
export function pickBand(roll: number): number {
  for (let i = 0; i < GRASS_BANDS.length; i++) {
    if (roll < GRASS_BANDS[i].cumulative) return i;
  }
  return GRASS_BANDS.length - 1;
}

// --- wind -----------------------------------------------------------------

/** Sway phase rate, rad/s. A ~7 s period: the slow body of the motion. */
export const GRASS_SWAY_RATE = 0.9;
/**
 * Ripple phase rate, rad/s — the faster gust riding on top of the sway.
 * Deliberately an exact multiple of `GRASS_SWAY_RATE` so both terms complete a whole
 * number of cycles over `GRASS_TIME_WRAP` and the wrap is invisible.
 */
export const GRASS_RIPPLE_RATE = GRASS_SWAY_RATE * 3;
/**
 * Seconds after which the shader clock wraps. `GRASS_SWAY_RATE * WRAP` is 2π·900 and
 * `GRASS_RIPPLE_RATE * WRAP` is 2π·2700, so both sines land back on their own phase
 * and nothing pops. Wrapping at all is what keeps `sin()` precise in a float32
 * uniform through a session measured in days.
 */
export const GRASS_TIME_WRAP = (2 * Math.PI * 900) / GRASS_SWAY_RATE;

/** Wrap the shader clock into [0, GRASS_TIME_WRAP). Pure. */
export function wrapWindTime(t: number): number {
  const w = t % GRASS_TIME_WRAP;
  return w < 0 ? w + GRASS_TIME_WRAP : w;
}

/** Gust wavenumbers along s and lateral, rad/m — a ~35 m gust wavelength. */
const RIPPLE_K_S = 0.18;
const RIPPLE_K_LAT = 0.1;

const TWO_PI = Math.PI * 2;

/**
 * Spatial phase of the travelling gust at (s, lat), in [0, 2π).
 *
 * Keyed off path coordinates rather than world XZ on purpose: the scene rebases
 * past ~2 km (§5.2), and a world-space phase would jump the whole gust pattern
 * on that frame. Wrapped here rather than in the shader so the float32 attribute
 * stays precise however far down the road the player is.
 */
export function ripplePhase(s: number, lat: number): number {
  const p = (s * RIPPLE_K_S + lat * RIPPLE_K_LAT) % TWO_PI;
  return p < 0 ? p + TWO_PI : p;
}

/**
 * Per-cluster sway phase offset in [0, 2π), so a field does not move in
 * lockstep. Deterministic in (s, lat): the same stretch of road regenerates
 * with the same phases (§5.7).
 */
export function swayPhase(s: number, lat: number): number {
  const h = Math.sin(s * 12.9898 + lat * 78.233) * 43758.5453;
  return (h - Math.floor(h)) * TWO_PI;
}

/**
 * Wind displacement, in meters at the blade tip, on a still day.
 *
 * Tuned by eye against the shader's own envelope rather than picked as a
 * plausible-looking number. `amp` below is `uWindPower * bend * (0.55 + 0.45 *
 * sway + gust)`, and `gust` swings +-0.45, so a tip travels between ~0.1x and
 * ~1.45x this value. At 0.055 that was a 0.6-8 cm swing on a blade 50-100 cm
 * tall — under a degree of lean, which is invisible in motion and made the
 * field read as a still photograph. Clear weather is most of the play time, so
 * this is the value that decides whether the grass looks alive at all.
 */
const WIND_CALM = 0.13;
/**
 * Wind displacement at the tip in the heaviest rain. Held at ~2.5x calm so a
 * squall still reads as a distinct step up rather than as more of the same.
 */
const WIND_GUSTY = 0.32;
/** Extra displacement while the leaf/petal drift episode is running. */
const WIND_LEAF_BONUS = 0.09;

/**
 * Tip displacement the wind shader should aim for, given the crossfaded
 * intensity of the rain and leaf weather states (`Weather.intensity`). Pure, so
 * the weather → wind mapping is testable without a scene.
 */
export function windStrength(rainIntensity: number, leafIntensity: number): number {
  const rain = THREE.MathUtils.clamp(rainIntensity, 0, 1);
  const leaves = THREE.MathUtils.clamp(leafIntensity, 0, 1);
  return WIND_CALM + (WIND_GUSTY - WIND_CALM) * rain + WIND_LEAF_BONUS * leaves;
}

/** Wind heading, radians, and how far it wanders either side of it. */
const WIND_ANGLE = 0.7;
const WIND_SWING = 0.35;
/** Rate the heading wanders at, rad/s — a ~50 s round trip. */
const WIND_TURN = 0.125;
/** Rate the shader's wind power chases a weather change, per second. */
const WIND_LERP = 1.5;

// --- cluster proto --------------------------------------------------------

/** Radius, in meters, that one cluster's blades are scattered over. */
const CLUSTER_SPREAD = 0.55;
/** Blade height range in meters, before the per-instance scale. */
const BLADE_MIN_H = 0.3;
const BLADE_MAX_H = 0.62;
/** Half-width of a blade at its base, in meters. */
const BLADE_HALF_W = 0.045;
/**
 * How far a blade's normal is tipped away from world-up toward its own face,
 * 0 = shade exactly like the ground beneath it. Kept small: a true face normal
 * on a near-vertical blade reads as a dark stripe against the lit field.
 */
const NORMAL_FACE_BIAS = 0.35;

/**
 * One cluster of blades, in local space with its base at the origin.
 *
 * Every blade quad is emitted with *both* windings and the material renders
 * front faces only, so a blade is visible from either side while keeping the
 * up-biased normal on both. `side: DoubleSide` would flip the normal on the
 * back face and leave half the field unlit.
 */
function buildClusterGeo(blades: number, segments: number): THREE.BufferGeometry {
  const perBlade = (segments + 1) * 2;
  const vertexCount = blades * perBlade;
  const pos = new Float32Array(vertexCount * 3);
  const nrm = new Float32Array(vertexCount * 3);
  const col = new Float32Array(vertexCount * 3);
  const bend = new Float32Array(vertexCount);
  // Two windings per quad, two triangles each.
  const idx = new Uint16Array(blades * segments * 12);

  const r = rng(90210);
  let v = 0;
  let k = 0;
  for (let b = 0; b < blades; b++) {
    const theta = r() * TWO_PI;
    const radius = Math.sqrt(r()) * CLUSTER_SPREAD;
    const bx = Math.cos(theta) * radius;
    const bz = Math.sin(theta) * radius;
    const h = BLADE_MIN_H + r() * (BLADE_MAX_H - BLADE_MIN_H);
    const yaw = r() * TWO_PI;
    // Width axis of the blade's plane.
    const wx = Math.cos(yaw);
    const wz = Math.sin(yaw);
    // Resting lean, so a cluster is not a bundle of flagpoles.
    const leanAngle = r() * TWO_PI;
    const lean = (0.1 + r() * 0.16) * h;
    const lx = Math.cos(leanAngle) * lean;
    const lz = Math.sin(leanAngle) * lean;
    // Face normal, tipped most of the way back to world-up.
    let nx = -wz * NORMAL_FACE_BIAS;
    let nz = wx * NORMAL_FACE_BIAS;
    let ny = 1;
    const nLen = Math.hypot(nx, ny, nz);
    nx /= nLen;
    ny /= nLen;
    nz /= nLen;

    const base = v;
    for (let seg = 0; seg <= segments; seg++) {
      const t = seg / segments;
      const halfW = BLADE_HALF_W * (1 - 0.85 * t);
      const cx = bx + lx * t * t;
      const cz = bz + lz * t * t;
      const y = h * t;
      // Painterly vertical gradient, dark at the root like every other proto.
      const shade = 0.62 + 0.46 * t;
      for (let side = 0; side < 2; side++) {
        const sgn = side === 0 ? -1 : 1;
        const o = v * 3;
        pos[o] = cx + wx * halfW * sgn;
        pos[o + 1] = y;
        pos[o + 2] = cz + wz * halfW * sgn;
        nrm[o] = nx;
        nrm[o + 1] = ny;
        nrm[o + 2] = nz;
        col[o] = shade;
        col[o + 1] = shade;
        col[o + 2] = shade;
        // Cubic-ish mask: the root stays planted, the tip carries the travel.
        bend[v] = t * t * (0.35 + 0.65 * t);
        v++;
      }
    }

    for (let seg = 0; seg < segments; seg++) {
      const a = base + seg * 2;
      const bI = a + 1;
      const c = a + 2;
      const d = a + 3;
      idx[k++] = a;
      idx[k++] = bI;
      idx[k++] = c;
      idx[k++] = bI;
      idx[k++] = d;
      idx[k++] = c;
      // Reversed winding: the same blade seen from behind, same normal.
      idx[k++] = c;
      idx[k++] = bI;
      idx[k++] = a;
      idx[k++] = c;
      idx[k++] = d;
      idx[k++] = bI;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aBend', new THREE.BufferAttribute(bend, 1));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  return geo;
}

// --- placement ------------------------------------------------------------

/**
 * Grass leans with the face it stands on, but not all the way: a tussock on a
 * hillside still grows toward the light. Mirrors `SLOPE_FOLLOW`'s intent for
 * the merged props (§5.7) without adding a `SceneryKind`, which that table is
 * deliberately exhaustive over.
 */
const GRASS_FOLLOW = 0.85;
/** Sink, in meters, that hides the blade roots in the surface. */
const GRASS_SINK = 0.04;
/** Per-cluster uniform scale range. */
const SCALE_MIN = 0.72;
const SCALE_MAX = 1.5;
/**
 * Grass sits a touch deeper than the terrain sheet it stands on, so the cover
 * reads as its own layer rather than dissolving into the ground colour.
 */
const TINT_SHADE = 0.86;

const rowsPerChunk = CHUNK_LEN / TER_ROW_STEP;

// Scratch for the build. Module scope so a chunk build allocates only the
// buffers it hands to three.js.
const cornerA = new THREE.Vector3();
const cornerB = new THREE.Vector3();
const cornerC = new THREE.Vector3();
const cornerD = new THREE.Vector3();
const edge0 = new THREE.Vector3();
const edge1 = new THREE.Vector3();
const faceNormal = new THREE.Vector3();
const clusterPos = new THREE.Vector3();
const clusterQuat = new THREE.Quaternion();
const clusterScale = new THREE.Vector3();
const clusterMat = new THREE.Matrix4();
const groundLo = new THREE.Color();
const groundHi = new THREE.Color();
const altLo = new THREE.Color();
const altHi = new THREE.Color();
const tintA = new THREE.Color();
const tintB = new THREE.Color();

/** Read grid corner `(row, col)` out of the packed row cache. */
function readCorner(grid: Float64Array, row: number, col: number, out: THREE.Vector3): void {
  const o = (row * TER_COLS.length + col) * TERRAIN_ROW_STRIDE;
  out.set(grid[o], grid[o + 1], grid[o + 2]);
}

export class GrassField {
  /** Bumped whenever the field's shape changes; `ChunkManager` watches it. */
  private rev = 0;
  private quality: Quality;
  private tier: GrassTier;
  /**
   * Proto and material per tier, built on first use and kept until `dispose`.
   * Deliberately *not* rebuilt-and-released on a quality change: live chunk
   * meshes still reference the outgoing material until `ChunkManager` swaps
   * them on its next `update`, and there are only three tiers to hold.
   */
  private protos = new Map<Quality, THREE.BufferGeometry>();
  private materials = new Map<Quality, THREE.MeshToonMaterial>();
  private time = 0;
  private turn = 0;
  private readonly uTime = { value: 0 };
  private readonly uWindDir = {
    value: new THREE.Vector2(Math.cos(WIND_ANGLE), Math.sin(WIND_ANGLE)),
  };
  private readonly uWindPower = { value: WIND_CALM };
  /** One row cache, reused by every chunk build. */
  private grid = new Float64Array((rowsPerChunk + 1) * TER_COLS.length * TERRAIN_ROW_STRIDE);

  constructor(quality: Quality = 'high') {
    this.quality = quality;
    this.tier = GRASS_TIERS[quality];
  }

  /** Chunks of grass built ahead of the car, at the current quality. */
  get ahead(): number {
    return this.tier.ahead;
  }

  /**
   * Revision of the field's shape. `ChunkManager` records this on each chunk
   * as it builds that chunk's grass (`Chunk.grassRev`) and rebuilds any chunk
   * holding an older one, which is how a quality change reaches the chunks
   * that were built under the previous tier.
   */
  get revision(): number {
    return this.rev;
  }

  /**
   * Re-shape the field for a quality tier. Routed from `main.ts` through the
   * same `UIActions.setQuality` path `PostFX.setQuality` takes.
   */
  setQuality(quality: Quality): void {
    if (quality === this.quality) return;
    this.quality = quality;
    this.tier = GRASS_TIERS[quality];
    this.rev++;
  }

  /**
   * Advance the wind. Called once per frame from the loop with the frame's
   * `dt` and the strength `windStrength` derived from the weather. Allocation
   * free: every uniform is mutated in place (§14).
   */
  tick(dt: number, strength: number): void {
    this.time = wrapWindTime(this.time + dt);
    this.uTime.value = this.time;
    this.turn += dt * WIND_TURN;
    if (this.turn > TWO_PI) this.turn -= TWO_PI;
    const angle = WIND_ANGLE + Math.sin(this.turn) * WIND_SWING;
    this.uWindDir.value.set(Math.cos(angle), Math.sin(angle));
    const k = Math.min(1, dt * WIND_LERP);
    this.uWindPower.value += (strength - this.uWindPower.value) * k;
  }

  /**
   * Build the grass for one chunk, positioned relative to `anchor` — the chunk
   * group's own origin, so the mesh rides the group through the floating-origin
   * rebase without ever holding an absolute position of its own.
   */
  build(path: RoadPath, index: number, anchor: THREE.Vector3): THREE.InstancedMesh | null {
    const tier = this.tier;
    if (tier.clusters <= 0 || GRASS_BANDS.length === 0) return null;
    const s0 = index * CHUNK_LEN;
    const s1 = s0 + CHUNK_LEN;

    // The terrain grid for this chunk, exactly as buildTerrain lays it out.
    const cols = TER_COLS.length;
    const grid = this.grid;
    for (let row = 0; row <= rowsPerChunk; row++) {
      terrainRow(path, s0 + row * TER_ROW_STEP, grid, row * cols * TERRAIN_ROW_STRIDE);
    }

    // Two colour samples per chunk rather than one per cluster: BLEND_LEN is
    // 520 m, so within a 60 m chunk the biome palette is all but linear, and
    // sampling at both ends keeps the field continuous across the seam.
    blendColor(s0, (b) => b.ground, groundLo);
    blendColor(s1, (b) => b.ground, groundHi);
    blendColor(s0, (b) => b.groundAlt, altLo);
    blendColor(s1, (b) => b.groundAlt, altHi);

    const count = tier.clusters;
    // The proto is shared; the clone exists so this chunk can carry its own
    // instanced attribute and be disposed without touching anyone else's.
    const geo = this.protoFor(this.quality).clone();
    const wind = new Float32Array(count * 2);
    const mesh = new THREE.InstancedMesh(geo, this.materialFor(this.quality), count);

    // Seeded off the chunk index, like buildScenery, so a stretch of road
    // regenerates identically however many times it is revisited (§5.7).
    const r = rng((index * 2246822519 + 374761393) % 4294967291);

    for (let i = 0; i < count; i++) {
      const row = Math.min(rowsPerChunk - 1, Math.floor(r() * rowsPerChunk));
      const band = GRASS_BANDS[pickBand(r())];
      const j = band.j;
      const u = r();
      const v = r();

      readCorner(grid, row, j, cornerA);
      readCorner(grid, row, j + 1, cornerB);
      readCorner(grid, row + 1, j, cornerC);
      readCorner(grid, row + 1, j + 1, cornerD);

      // The terrain index buffer splits each cell on the b-c diagonal
      // (gridIndices emits a,b,c then b,d,c), so u + v = 1 is the seam and the
      // interpolation below lands on the triangle the renderer actually draws.
      if (u + v <= 1) {
        clusterPos
          .copy(cornerA)
          .multiplyScalar(1 - u - v)
          .addScaledVector(cornerB, v)
          .addScaledVector(cornerC, u);
        edge0.subVectors(cornerB, cornerA);
        edge1.subVectors(cornerC, cornerA);
      } else {
        clusterPos
          .copy(cornerB)
          .multiplyScalar(1 - u)
          .addScaledVector(cornerD, u + v - 1)
          .addScaledVector(cornerC, 1 - v);
        edge0.subVectors(cornerD, cornerB);
        edge1.subVectors(cornerC, cornerB);
      }
      faceNormal.crossVectors(edge0, edge1);
      if (faceNormal.lengthSq() < 1e-12) faceNormal.set(0, 1, 0);
      else faceNormal.normalize();
      if (faceNormal.y < 0) faceNormal.negate();

      const s = s0 + (row + u) * TER_ROW_STEP;
      const lat = TER_COLS[j] + v * (TER_COLS[j + 1] - TER_COLS[j]);

      const scale = SCALE_MIN + r() * (SCALE_MAX - SCALE_MIN);
      propOrientation(r() * TWO_PI, faceNormal, GRASS_FOLLOW, clusterQuat);
      clusterMat.compose(
        clusterPos.set(clusterPos.x - anchor.x, clusterPos.y - GRASS_SINK, clusterPos.z - anchor.z),
        clusterQuat,
        clusterScale.setScalar(scale),
      );
      mesh.setMatrixAt(i, clusterMat);

      // Colour follows the biome through blendColor like every other visual
      // (§5.4); reading BIOMES[id] directly would pop at the crossfade.
      const f = (s - s0) / CHUNK_LEN;
      tintA.copy(groundLo).lerp(groundHi, f);
      tintB.copy(altLo).lerp(altHi, f);
      tintA.lerp(tintB, r());
      const jitter = TINT_SHADE * (0.84 + r() * 0.32);
      tintA.setRGB(
        tintA.r * jitter * (0.94 + r() * 0.12),
        tintA.g * jitter,
        tintA.b * jitter * (0.88 + r() * 0.2),
      );
      mesh.setColorAt(i, tintA);

      wind[i * 2] = swayPhase(s, lat);
      wind[i * 2 + 1] = ripplePhase(s, lat);
    }

    geo.setAttribute('aWind', new THREE.InstancedBufferAttribute(wind, 2));
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = false;
    mesh.receiveShadow = tier.receiveShadow;
    // Computed here rather than lazily mid-render, and inflated by the wind's
    // reach so a bending field does not pop out at the edge of the frustum.
    mesh.computeBoundingSphere();
    if (mesh.boundingSphere) mesh.boundingSphere.radius += 1;
    return mesh;
  }

  /** Release every tier's shared proto and material. */
  dispose(): void {
    for (const g of this.protos.values()) g.dispose();
    for (const m of this.materials.values()) m.dispose();
    this.protos.clear();
    this.materials.clear();
  }

  // ------------------------------------------------------------------
  private protoFor(quality: Quality): THREE.BufferGeometry {
    let geo = this.protos.get(quality);
    if (!geo) {
      const tier = GRASS_TIERS[quality];
      geo = buildClusterGeo(tier.blades, tier.segments);
      this.protos.set(quality, geo);
    }
    return geo;
  }

  private materialFor(quality: Quality): THREE.MeshToonMaterial {
    let mat = this.materials.get(quality);
    if (!mat) {
      mat = this.buildMaterial(quality);
      this.materials.set(quality, mat);
    }
    return mat;
  }

  private buildMaterial(quality: Quality): THREE.MeshToonMaterial {
    const ripple = GRASS_TIERS[quality].ripple;
    const mat = new THREE.MeshToonMaterial({
      color: 0xffffff,
      vertexColors: true,
      gradientMap: toonRamp(),
      // Front faces only; buildClusterGeo emits both windings so the blade is
      // visible from either side with its normal still pointing up.
      side: THREE.FrontSide,
    });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.uTime;
      shader.uniforms.uWindDir = this.uWindDir;
      shader.uniforms.uWindPower = this.uWindPower;
      shader.vertexShader =
        `attribute float aBend;
attribute vec2 aWind;
uniform float uTime;
uniform vec2 uWindDir;
uniform float uWindPower;
` +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
{
  float bend = aBend;
  float sway = sin( uTime * ${GRASS_SWAY_RATE.toFixed(4)} + aWind.x );
  ${
    ripple
      ? `float gust = sin( uTime * ${GRASS_RIPPLE_RATE.toFixed(4)} - aWind.y ) * 0.45;`
      : `float gust = 0.0;`
  }
  float amp = uWindPower * bend * ( 0.55 + 0.45 * sway + gust );
  // The instance matrix carries a random yaw, so the world wind direction is
  // projected onto the instance's own axes before it displaces anything. The
  // inverse scale cancels the uniform scale the matrix re-applies below, which
  // keeps the tip travel in world meters whatever size the cluster is.
  vec3 iAxisX = instanceMatrix[ 0 ].xyz;
  vec3 iAxisZ = instanceMatrix[ 2 ].xyz;
  float invScale = inversesqrt( max( dot( iAxisX, iAxisX ), 1e-6 ) );
  vec3 windWorld = vec3( uWindDir.x, 0.0, uWindDir.y );
  transformed.x += dot( iAxisX, windWorld ) * invScale * amp;
  transformed.z += dot( iAxisZ, windWorld ) * invScale * amp;
  // A bending blade is shorter than a straight one; without this the tips
  // stretch as they lean.
  transformed.y -= bend * abs( amp ) * 0.3;
}`,
        );
    };
    // onBeforeCompile output depends on the tier, so the program cache must not
    // hand a low-tier program to a high-tier material.
    mat.customProgramCacheKey = () => `everroad-grass-${quality}`;
    return mat;
  }
}
