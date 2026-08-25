import * as THREE from 'three';
import { BIOME_ORDER, type BiomeId } from '../types';

/**
 * Biome visual definitions + the blend function that makes the world drift
 * seamlessly from one biome into the next. Everything (terrain colors, scenery
 * mix, fog, sky tint) samples the same weights so transitions stay coherent.
 */

/** Scenery prototype kinds understood by scenery.ts. */
/**
 * Every scenery kind, as a runtime list. The type derives from it so that
 * anything iterating kinds (the model viewer, the model validator's drift
 * test) cannot silently fall out of step with the union.
 */
export const SCENERY_KINDS = [
  'oak',
  'maple',
  'pine',
  'poplar',
  'cherryTree',
  'rock',
  'flowers',
  'grassTuft',
  'hay',
  'fence',
  'windmill',
  'sunflowerPatch',
  'lavenderRow',
  'reeds',
] as const;

export type SceneryKind = (typeof SCENERY_KINDS)[number];

export interface BiomeVisual {
  id: BiomeId;
  /** Ground base color + variation color (vertex-blended by noise). */
  ground: string;
  groundAlt: string;
  /** Canopy color choices for this biome's trees. */
  canopy: string[];
  flowerColors: string[];
  /** Tint lerped into sky horizon + fog (subtle). */
  skyTint: string;
  fogTint: string;
  /** Extra fog density multiplier (mistiness). */
  mist: number;
  /** Relative scenery weights. */
  mix: Partial<Record<SceneryKind, number>>;
  /**
   * Merged-bake scenery items per chunk (60 m), before the per-chunk +/-15%
   * jitter. These are *clump members*, not clump anchors — `buildScenery`
   * emits them in seeded runs, so the count buys groves and drifts rather than
   * an even sprinkle (docs/ARCHITECTURE.md §5.7).
   *
   * Dense ground cover is not counted here: `world/grass.ts` runs its own
   * instanced field at a couple of thousand clusters a chunk, which is why
   * `grassTuft` weights are low — it is the occasional larger tussock now, not
   * the ground itself.
   */
  density: number;
}

export const BIOMES: Record<BiomeId, BiomeVisual> = {
  meadow: {
    id: 'meadow',
    ground: '#6ec554',
    groundAlt: '#a2e07c',
    canopy: ['#4fae47', '#72cc58', '#8fd968'],
    flowerColors: ['#ffffff', '#ffd94a', '#ff9ecf'],
    skyTint: '#bfe3ff',
    fogTint: '#d2ecd2',
    mist: 1.0,
    mix: { oak: 6, poplar: 2, rock: 1.2, flowers: 9, grassTuft: 3, fence: 0.6 },
    density: 78,
  },
  farmland: {
    id: 'farmland',
    ground: '#dfbe55',
    groundAlt: '#f0dc8d',
    canopy: ['#87a844', '#a3bd55'],
    flowerColors: ['#f2e2a0', '#e8c96a'],
    skyTint: '#ffe9c4',
    fogTint: '#efe0b8',
    mist: 0.9,
    mix: {
      oak: 2.5,
      poplar: 3.5,
      hay: 4,
      fence: 3,
      // Raised from 0.5 when clumping landed. A weight now buys a clump
      // *anchor*, and the props it emits are `weight x E[clumpSize]` — so a
      // windmill (clump 1-1) lost ground to every neighbour that clumps as
      // `density` rose 38 -> 68, falling from ~1.21 per chunk to ~0.68. The
      // windmill is farmland's signature (§5.4); it should not get rarer in a
      // change whose whole purpose was a fuller world. Solves
      // `68w / (49.2 + w) = 1.21` for the pre-clumping frequency.
      windmill: 0.9,
      grassTuft: 2,
      rock: 0.6,
      flowers: 2.5,
    },
    density: 68,
  },
  sunflower: {
    id: 'sunflower',
    ground: '#a9cc59',
    groundAlt: '#c8e084',
    canopy: ['#63b04e', '#84c45e'],
    flowerColors: ['#ffd23f', '#ffbe2e'],
    skyTint: '#c9edf0',
    fogTint: '#e4f0c8',
    mist: 0.9,
    mix: { sunflowerPatch: 7, oak: 2.5, poplar: 2.5, fence: 1, grassTuft: 1.5, flowers: 4 },
    density: 84,
  },
  autumn: {
    id: 'autumn',
    ground: '#d4884a',
    groundAlt: '#eaa85e',
    canopy: ['#e8542f', '#f07f36', '#d43b28', '#f2a53a', '#c9502e'],
    flowerColors: ['#f2a53a', '#e8542f'],
    skyTint: '#ffd9a8',
    fogTint: '#f2c79c',
    mist: 1.15,
    mix: { maple: 11, oak: 3.5, rock: 1.2, grassTuft: 1.5, flowers: 3, fence: 0.4 },
    density: 94,
  },
  pine: {
    id: 'pine',
    ground: '#649e72',
    groundAlt: '#88bd8d',
    canopy: ['#337a66', '#3f947a', '#2f6e59'],
    flowerColors: ['#cfe8e0', '#9ecfc0'],
    skyTint: '#cfe6ea',
    fogTint: '#c8ded8',
    mist: 1.6,
    mix: { pine: 12, poplar: 0.8, rock: 2.5, grassTuft: 1.5, flowers: 2.5 },
    density: 88,
  },
  lavender: {
    id: 'lavender',
    ground: '#94b465',
    groundAlt: '#b5cc82',
    canopy: ['#6fa855', '#8cbd68'],
    flowerColors: ['#a37fe0', '#c39af0', '#8f68cc'],
    skyTint: '#e6d9f5',
    fogTint: '#ded0ec',
    mist: 1.1,
    mix: {
      lavenderRow: 8,
      oak: 2,
      poplar: 1.8,
      rock: 0.8,
      grassTuft: 1.2,
      fence: 0.8,
      flowers: 2.5,
    },
    density: 80,
  },
  cherry: {
    id: 'cherry',
    ground: '#96cf6d',
    groundAlt: '#bce38f',
    canopy: ['#f2a0c0', '#f7bcd2', '#ea88ad', '#fad2e0'],
    flowerColors: ['#ffd2e4', '#ffffff'],
    skyTint: '#ffe3ee',
    fogTint: '#f5d8e4',
    mist: 1.1,
    mix: { cherryTree: 11, oak: 1, rock: 1, flowers: 6, grassTuft: 1.5 },
    density: 84,
  },
  wetland: {
    id: 'wetland',
    ground: '#7fae74',
    groundAlt: '#a4c688',
    canopy: ['#5f9e5c', '#7ab06a'],
    flowerColors: ['#e8e2a8', '#d9f0f2'],
    skyTint: '#d9e8f0',
    fogTint: '#d5e4e6',
    mist: 1.9,
    mix: { reeds: 8, poplar: 2.5, oak: 1, rock: 1.2, grassTuft: 1.5, flowers: 3 },
    density: 76,
  },
};

/** Meters each biome lasts before blending into the next. (~1.7 miles) */
export const BIOME_LEN = 2700;
/** Meters of crossfade at each boundary. */
export const BLEND_LEN = 520;

/** One biome's share of the blend at a sampled point. */
export interface BiomeWeight {
  id: BiomeId;
  w: number;
}

export interface BiomeSample {
  /** Dominant biome. */
  id: BiomeId;
  next: BiomeId;
  /** 0..1 progress of blend into `next` (0 = fully `id`). */
  blend: number;
  /** Sparse weights over all biomes (sums to 1; at most 2 nonzero). */
  weights: BiomeWeight[];
}

/**
 * A `BiomeSample` a caller can own and hand to `biomeAt` as an out-param.
 *
 * `biomeAt` is called several times a frame and the frame loop holds a zero
 * steady-state allocation budget (docs/ARCHITECTURE.md §14), so the sample is
 * written in place rather than built fresh. Any caller that *keeps* the result
 * past its own statement must pass a sample of its own — the module-level
 * default is scratch and the next call overwrites it.
 */
export function createBiomeSample(): BiomeSample {
  return {
    id: BIOME_ORDER[0],
    next: BIOME_ORDER[0],
    blend: 0,
    weights: [{ id: BIOME_ORDER[0], w: 1 }],
  };
}

/**
 * Scratch for this module's own helpers. Deliberately *not* `defaultSample`:
 * `blendColor`/`blendNumber`/`pickScenery` are called from the middle of frame
 * code that may be holding a `biomeAt(s)` result, and clobbering it from under
 * that caller is exactly the aliasing bug the out-param is meant to avoid.
 * These three never nest inside one another, so one scratch serves all of them.
 */
const helperSample = createBiomeSample();

/**
 * Sample biome weights at path distance s (meters), written into `out`.
 *
 * `out` is mandatory on purpose. A shared default scratch made the safe use
 * (`biomeAt(s).id`, read immediately) indistinguishable from the unsafe one
 * (holding the sample across another call that refills it), and the difference
 * is invisible at the call site. Requiring the caller to own its scratch —
 * from `createBiomeSample()` — turns that invariant into a compile error.
 */
export function biomeAt(s: number, out: BiomeSample): BiomeSample {
  const n = BIOME_ORDER.length;
  const cycle = (((s / BIOME_LEN) % n) + n) % n;
  const idx = Math.floor(cycle);
  const frac = cycle - idx; // 0..1 within current biome segment
  const cur = BIOME_ORDER[idx];
  const nxt = BIOME_ORDER[(idx + 1) % n];

  // Blend happens in the last BLEND_LEN meters of the segment.
  const blendStart = 1 - BLEND_LEN / BIOME_LEN;
  let blend = 0;
  if (frac > blendStart) {
    const t = (frac - blendStart) / (1 - blendStart);
    blend = t * t * (3 - 2 * t); // smoothstep
  }

  // Entry objects are reused; only the 1 -> 2 growth at a crossfade's first
  // frame ever allocates, and only once per sample per boundary.
  const w = out.weights;
  if (w.length === 0) w.push({ id: cur, w: 1 });
  w[0].id = cur;
  w[0].w = blend <= 0 ? 1 : 1 - blend;
  if (blend <= 0) {
    w.length = 1;
  } else if (w.length < 2) {
    w.push({ id: nxt, w: blend });
  } else {
    w.length = 2;
    w[1].id = nxt;
    w[1].w = blend;
  }

  out.id = blend > 0.5 ? nxt : cur;
  out.next = nxt;
  out.blend = blend;
  return out;
}

const tmpA = new THREE.Color();
const tmpB = new THREE.Color();

/** Blend a per-biome color field at s into `out`. */
export function blendColor(
  s: number,
  pick: (b: BiomeVisual) => string,
  out: THREE.Color,
): THREE.Color {
  const sample = biomeAt(s, helperSample);
  out.set(0, 0, 0);
  for (const { id, w } of sample.weights) {
    tmpA.set(pick(BIOMES[id]));
    out.add(tmpB.copy(tmpA).multiplyScalar(w));
  }
  return out;
}

/** Blend a numeric per-biome field at s. */
export function blendNumber(s: number, pick: (b: BiomeVisual) => number): number {
  const sample = biomeAt(s, helperSample);
  let v = 0;
  for (const { id, w } of sample.weights) v += pick(BIOMES[id]) * w;
  return v;
}

/** Pick a scenery kind at s using blended mix weights. */
export function pickScenery(s: number, rand: number): SceneryKind {
  const sample = biomeAt(s, helperSample);
  const acc: Array<{ kind: SceneryKind; w: number }> = [];
  let total = 0;
  for (const { id, w } of sample.weights) {
    const mix = BIOMES[id].mix;
    for (const kind in mix) {
      const weight = (mix[kind as SceneryKind] ?? 0) * w;
      if (weight <= 0) continue;
      const existing = acc.find((a) => a.kind === kind);
      if (existing) existing.w += weight;
      else acc.push({ kind: kind as SceneryKind, w: weight });
      total += weight;
    }
  }
  let r = rand * total;
  for (const a of acc) {
    r -= a.w;
    if (r <= 0) return a.kind;
  }
  return 'grassTuft';
}

/**
 * Fraction of a biome segment that is pure, before the crossfade into the
 * next biome begins. `biomeAt` starts blending at this point in the segment.
 */
const PURE_FRAC = 1 - BLEND_LEN / BIOME_LEN;

/**
 * Path distance s (m) that lands `frac` (0..1) of the way through `id`'s
 * segment — the inverse of `biomeAt`, used to seed attract mode into a chosen
 * biome (docs/ARCHITECTURE.md §5.4).
 *
 * `frac` is clamped just below the crossfade zone (`PURE_FRAC`, ~0.807), so
 * `biomeAt(sForBiome(id, f)).id === id` holds for every `f`. Values in roughly
 * 0.15–0.7 sit comfortably clear of the `BLEND_LEN` crossfade at both ends of
 * the segment, which is the range a caller wanting an unambiguously "in this
 * biome" vantage should draw from.
 */
export function sForBiome(id: BiomeId, frac = 0.4): number {
  const idx = BIOME_ORDER.indexOf(id);
  const f = THREE.MathUtils.clamp(frac, 0, PURE_FRAC - 1e-6);
  return (idx + f) * BIOME_LEN;
}
