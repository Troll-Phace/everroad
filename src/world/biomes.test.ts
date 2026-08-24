import { describe, it, expect } from 'vitest';
import { BIOMES, BIOME_LEN, BLEND_LEN, biomeAt, blendNumber } from './biomes';
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
