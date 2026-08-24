import { describe, it, expect, beforeEach } from 'vitest';
import { defaultState, defaultRuntime } from '../../state';
import { checkAchievements } from './tracker';
import {
  SLOW_DRIVE_REQUIRED_SEC,
  getSlowDriveSeconds,
  resetSlowDrive,
  updateSlowDrive,
} from './slowDrive';

function ids(defs: ReturnType<typeof checkAchievements>): string[] {
  return defs.map((d) => d.id);
}

beforeEach(() => {
  resetSlowDrive();
});

describe('checkAchievements — session count', () => {
  it('keeps "Welcome Back" locked on a fresh install (sessionCount 1 after the boot increment)', () => {
    const state = defaultState();
    state.stats.sessionCount += 1; // what main.ts does at boot
    expect(state.stats.sessionCount).toBe(1);
    const unlocked = ids(checkAchievements(state, defaultRuntime()));
    expect(unlocked).not.toContain('welcome-back');
  });

  it('unlocks "Welcome Back" on the second session', () => {
    const state = defaultState();
    state.stats.sessionCount = 2;
    const unlocked = ids(checkAchievements(state, defaultRuntime()));
    expect(unlocked).toContain('welcome-back');
  });
});

describe('checkAchievements — token bounties', () => {
  it('counts token rewards into totalTokensEarned so the prestige ladder can chain', () => {
    const state = defaultState();
    state.stats.prestigeCount = 10; // Eternal Return rewards 10 tokens
    const unlocked = ids(checkAchievements(state, defaultRuntime()));
    expect(unlocked).toContain('eternal-return');
    expect(state.stats.totalTokensEarned).toBe(10);
    expect(state.currencies.tokens).toBe(10);
    // First Horizon (totalTokensEarned >= 1) chains in the same pass.
    expect(unlocked).toContain('first-horizon');
  });
});

describe('slow-drive tracker (Sunday Stroll)', () => {
  it('requires a sustained amble, not a sampled ramp through the band', () => {
    const state = defaultState();
    const runtime = defaultRuntime();
    runtime.speedMph = 10;

    // A 0-to-cruise ramp spends only a moment in the band.
    updateSlowDrive(1.6, 10, false);
    expect(ids(checkAchievements(state, runtime))).not.toContain('sunday-stroll');

    // Leaving the band resets the run.
    updateSlowDrive(8, 10, false);
    updateSlowDrive(0.5, 60, false);
    expect(getSlowDriveSeconds()).toBe(0);
    updateSlowDrive(5, 10, false);
    expect(ids(checkAchievements(state, runtime))).not.toContain('sunday-stroll');

    // A genuinely sustained amble unlocks it.
    updateSlowDrive(SLOW_DRIVE_REQUIRED_SEC, 12, false);
    expect(ids(checkAchievements(state, runtime))).toContain('sunday-stroll');
  });

  it('holds (neither counts nor resets) while paused', () => {
    updateSlowDrive(6, 10, false);
    updateSlowDrive(30, 10, true);
    expect(getSlowDriveSeconds()).toBe(6);
  });

  it('ignores speeds at or below the walking threshold', () => {
    updateSlowDrive(5, 2, false);
    expect(getSlowDriveSeconds()).toBe(0);
  });
});
