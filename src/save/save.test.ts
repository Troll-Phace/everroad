import { describe, it, expect } from 'vitest';
import { exportSave, importSave } from './save';
import { defaultState } from '../state';
import { initEconomy, getPrestigePreview } from '../game/economy/economy';

/** Encode raw JSON text the same way exportSave does (EVR1. + base64). */
function encode(json: string): string {
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return `EVR1.${btoa(bin)}`;
}

describe('importSave', () => {
  it('round-trips a legitimate export', () => {
    const state = defaultState();
    state.currencies.coins = 1234;
    state.stats.journeyMiles = 7.5;
    const imported = importSave(exportSave(state));
    expect(imported).not.toBeNull();
    expect(imported!.currencies.coins).toBe(1234);
    expect(imported!.stats.journeyMiles).toBe(7.5);
  });

  it('rejects garbage and non-EVR1 codes', () => {
    expect(importSave('not a save')).toBeNull();
    expect(importSave('EVR1.%%%%')).toBeNull();
    expect(importSave(encode('"just a string"'))).toBeNull();
  });

  it('defuses a crafted 1e309 journeyMiles exploit once initEconomy runs', () => {
    const base = defaultState();
    const json = JSON.stringify(base).replace('"journeyMiles":0', '"journeyMiles":1e309');
    const imported = importSave(encode(json));
    expect(imported).not.toBeNull();
    // JSON.parse turns 1e309 into Infinity; the load path always runs
    // initEconomy next, which must neutralize it.
    initEconomy(imported!);
    expect(imported!.stats.journeyMiles).toBe(0);
    for (const [key, value] of Object.entries(imported!.stats)) {
      if (Array.isArray(value)) continue;
      expect(Number.isFinite(value), `stats.${key} should be finite`).toBe(true);
      expect(value as number, `stats.${key} should be non-negative`).toBeGreaterThanOrEqual(0);
    }
    const preview = getPrestigePreview(imported!);
    expect(preview.canPrestige).toBe(false);
    expect(Number.isFinite(preview.tokensOnPrestige)).toBe(true);
  });

  it('dedupes repeated achievement ids in an imported save', () => {
    const base = defaultState();
    base.achievements = ['first-mile', 'first-mile', 'open-road', 'first-mile'];
    const imported = importSave(exportSave(base));
    expect(imported!.achievements).toEqual(['first-mile', 'open-road']);
  });

  it('replaces a non-array achievements field with an empty list', () => {
    const base = defaultState();
    const json = JSON.stringify(base).replace('"achievements":[]', '"achievements":"hacked"');
    const imported = importSave(encode(json));
    expect(imported!.achievements).toEqual([]);
  });
});
