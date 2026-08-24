import { describe, it, expect } from 'vitest';
import { defaultState, newJourneyState } from './state';
import type { GameSettings } from './types';

/** A player who has been through the settings panel: nothing left at default. */
function tunedSettings(): GameSettings {
  return {
    audioEnabled: false,
    musicVolume: 0.15,
    sfxVolume: 0.3,
    quality: 'low',
    showFps: true,
  };
}

describe('newJourneyState', () => {
  it('carries every setting across unchanged', () => {
    const settings = tunedSettings();
    expect(newJourneyState(settings).settings).toEqual(settings);
  });

  it('preserves settings that differ from the defaults it starts from', () => {
    // The guard that matters: a fresh journey on a machine put on 'low' must
    // not be silently promoted back to the default 'high'.
    const fresh = defaultState().settings;
    const next = newJourneyState(tunedSettings()).settings;
    expect(next.quality).not.toBe(fresh.quality);
    expect(next.audioEnabled).not.toBe(fresh.audioEnabled);
    expect(next.quality).toBe('low');
    expect(next.audioEnabled).toBe(false);
  });

  it('erases the journey itself', () => {
    const base = defaultState();
    const next = newJourneyState(tunedSettings());
    expect(next.currencies).toEqual(base.currencies);
    expect(next.stats).toEqual(base.stats);
    expect(next.ownedCars).toEqual(base.ownedCars);
    expect(next.currentCarId).toBe(base.currentCarId);
    expect(next.achievements).toEqual([]);
    expect(next.upgrades).toEqual(base.upgrades);
    expect(next.globalUpgrades).toEqual({});
  });

  it('copies the settings rather than aliasing what the caller passed', () => {
    const settings = tunedSettings();
    const next = newJourneyState(settings);
    next.settings.quality = 'high';
    expect(settings.quality).toBe('low');
  });
});
