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
  /** Scenery items per chunk (60 m). */
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
    mix: { oak: 4, poplar: 1, rock: 1.5, flowers: 5, grassTuft: 6, fence: 0.8 },
    density: 42,
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
    mix: { oak: 1.5, poplar: 2, hay: 4, fence: 3, windmill: 0.5, grassTuft: 4, rock: 0.7 },
    density: 38,
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
    mix: { sunflowerPatch: 7, oak: 1.5, poplar: 1.5, fence: 1.2, grassTuft: 3, flowers: 2 },
    density: 46,
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
    mix: { maple: 8, oak: 2, rock: 1.5, grassTuft: 3, flowers: 1, fence: 0.5 },
    density: 52,
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
    mix: { pine: 9, rock: 3, grassTuft: 3, flowers: 0.8 },
    density: 48,
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
    mix: { lavenderRow: 8, oak: 1.2, poplar: 1, rock: 1, grassTuft: 2, fence: 1 },
    density: 44,
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
    mix: { cherryTree: 8, rock: 1.2, flowers: 4, grassTuft: 3 },
    density: 46,
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
    mix: { reeds: 8, poplar: 1.5, rock: 1.5, grassTuft: 3, flowers: 1.5 },
    density: 42,
  },
};

/** Meters each biome lasts before blending into the next. (~1.7 miles) */
export const BIOME_LEN = 2700;
/** Meters of crossfade at each boundary. */
export const BLEND_LEN = 520;

export interface BiomeSample {
  /** Dominant biome. */
  id: BiomeId;
  next: BiomeId;
  /** 0..1 progress of blend into `next` (0 = fully `id`). */
  blend: number;
  /** Sparse weights over all biomes (sums to 1; at most 2 nonzero). */
  weights: Array<{ id: BiomeId; w: number }>;
}

/** Sample biome weights at path distance s (meters). */
export function biomeAt(s: number): BiomeSample {
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

  const weights: Array<{ id: BiomeId; w: number }> =
    blend <= 0
      ? [{ id: cur, w: 1 }]
      : [
          { id: cur, w: 1 - blend },
          { id: nxt, w: blend },
        ];

  return { id: blend > 0.5 ? nxt : cur, next: nxt, blend, weights };
}

const tmpA = new THREE.Color();
const tmpB = new THREE.Color();

/** Blend a per-biome color field at s into `out`. */
export function blendColor(
  s: number,
  pick: (b: BiomeVisual) => string,
  out: THREE.Color,
): THREE.Color {
  const sample = biomeAt(s);
  out.set(0, 0, 0);
  for (const { id, w } of sample.weights) {
    tmpA.set(pick(BIOMES[id]));
    out.add(tmpB.copy(tmpA).multiplyScalar(w));
  }
  return out;
}

/** Blend a numeric per-biome field at s. */
export function blendNumber(s: number, pick: (b: BiomeVisual) => number): number {
  const sample = biomeAt(s);
  let v = 0;
  for (const { id, w } of sample.weights) v += pick(BIOMES[id]) * w;
  return v;
}

/** Pick a scenery kind at s using blended mix weights. */
export function pickScenery(s: number, rand: number): SceneryKind {
  const sample = biomeAt(s);
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
