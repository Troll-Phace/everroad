import { describe, it, expect } from 'vitest';
import { BIOMES, BIOME_LEN, BLEND_LEN, biomeAt, blendNumber, sForBiome } from './biomes';
import { BIOME_ORDER } from '../types';

describe('blendNumber', () => {
  it('matches the weighted average of the boundary biomes mid-blend', () => {
    // autumn (index 3) -> pine boundary: the largest mist gap (1.15 -> 1.6).
    const s = 4 * BIOME_LEN - BLEND_LEN / 2;
    const sample = biomeAt(s);
    expect(sample.blend).toBeGreaterThan(0);
    const expected = BIOMES.autumn.mist * (1 - sample.blend) + BIOMES.pine.mist * sample.blend;
    expect(blendNumber(s, (b) => b.mist)).toBeCloseTo(expected, 12);
  });

  it('stays continuous across the dominant-id flip at blend 0.5 (fog density must not pop)', () => {
    // Find where blend crosses 0.5 on the autumn -> pine boundary.
    const segStart = 3 * BIOME_LEN;
    let sFlip = 0;
    for (let s = segStart + BIOME_LEN - BLEND_LEN; s < segStart + BIOME_LEN; s += 0.25) {
      if (biomeAt(s).blend > 0.5) {
        sFlip = s;
        break;
      }
    }
    expect(sFlip).toBeGreaterThan(0);
    expect(biomeAt(sFlip).id).not.toBe(biomeAt(sFlip - 0.5).id); // the id does flip here
    const before = blendNumber(sFlip - 0.5, (b) => b.mist);
    const after = blendNumber(sFlip + 0.5, (b) => b.mist);
    expect(Math.abs(after - before)).toBeLessThan(0.01);
  });

  it('is continuous at every biome boundary', () => {
    for (let i = 0; i < BIOME_ORDER.length; i++) {
      const boundary = (i + 1) * BIOME_LEN;
      let prev = blendNumber(boundary - BLEND_LEN - 10, (b) => b.mist);
      for (let s = boundary - BLEND_LEN - 10; s <= boundary + 10; s += 1) {
        const v = blendNumber(s, (b) => b.mist);
        expect(Math.abs(v - prev)).toBeLessThan(0.02);
        prev = v;
      }
    }
  });
});

// ---------------------------------------------------------------------------
// sForBiome — the inverse of biomeAt, used to seed attract mode (§5.4)
// ---------------------------------------------------------------------------

describe('sForBiome', () => {
  const FRACS = [0, 0.15, 0.25, 0.4, 0.55, 0.7, 0.8, 0.95, 1];

  it.each(BIOME_ORDER)('round-trips %s through biomeAt at every frac', (id) => {
    for (const frac of FRACS) {
      expect(biomeAt(sForBiome(id, frac)).id).toBe(id);
    }
  });

  it('defaults to a frac that lands inside the biome', () => {
    for (const id of BIOME_ORDER) expect(biomeAt(sForBiome(id)).id).toBe(id);
  });

  it('sits clear of the crossfade for fracs in 0.15..0.7', () => {
    for (const id of BIOME_ORDER) {
      for (let frac = 0.15; frac <= 0.7001; frac += 0.05) {
        const sample = biomeAt(sForBiome(id, frac));
        // Not blending into the next biome...
        expect(sample.blend).toBe(0);
        // ...and comfortably past the crossfade that ends at the segment start.
        const intoSegment = sForBiome(id, frac) % BIOME_LEN;
        expect(intoSegment).toBeGreaterThan(0);
        expect(BIOME_LEN - intoSegment).toBeGreaterThan(BLEND_LEN);
      }
    }
  });

  it('advances monotonically with frac inside a segment', () => {
    for (const id of BIOME_ORDER) {
      expect(sForBiome(id, 0.6)).toBeGreaterThan(sForBiome(id, 0.2));
    }
  });

  it('places consecutive biomes one segment apart', () => {
    for (let i = 1; i < BIOME_ORDER.length; i++) {
      const gap = sForBiome(BIOME_ORDER[i], 0.4) - sForBiome(BIOME_ORDER[i - 1], 0.4);
      expect(gap).toBeCloseTo(BIOME_LEN, 9);
    }
  });

  it('clamps an out-of-range frac rather than spilling into a neighbour', () => {
    for (const id of BIOME_ORDER) {
      expect(biomeAt(sForBiome(id, -3)).id).toBe(id);
      expect(biomeAt(sForBiome(id, 42)).id).toBe(id);
    }
  });
});
