import { describe, it, expect } from 'vitest';
import { defaultState } from '../../state';
import { applyTick, getCoinRatePerMile, getPrestigePreview, initEconomy } from './economy';
import type { EconomyContext } from '../../types';

function neutralCtx(overrides: Partial<EconomyContext> = {}): EconomyContext {
  return {
    dtSec: 1 / 60,
    milesDelta: 0.02,
    isActive: false,
    combo: 1,
    biomeId: 'meadow',
    timePhase: 'day',
    weatherId: 'clear',
    ...overrides,
  };
}

describe('applyTick', () => {
  it('earns coins for the miles driven on a finite tick', () => {
    const state = defaultState();
    const ctx = neutralCtx();
    const expected = ctx.milesDelta * getCoinRatePerMile(state, ctx);
    const tick = applyTick(state, ctx);
    expect(tick.coinsEarned).toBeCloseTo(expected, 9);
    expect(state.currencies.coins).toBeCloseTo(expected, 9);
    expect(state.stats.journeyMiles).toBeCloseTo(ctx.milesDelta, 12);
    expect(state.stats.playTimeSec).toBeCloseTo(ctx.dtSec, 12);
  });

  it('treats a non-finite milesDelta as zero instead of poisoning the state', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      const state = defaultState();
      const tick = applyTick(state, neutralCtx({ milesDelta: bad }));
      expect(tick.coinsEarned).toBe(0);
      expect(state.currencies.coins).toBe(0);
      expect(state.stats.journeyMiles).toBe(0);
      expect(state.stats.lifetimeMiles).toBe(0);
      expect(state.stats.lifetimeCoins).toBe(0);
      expect(Number.isFinite(state.stats.idleMiles)).toBe(true);
    }
  });

  it('treats a non-finite dtSec as zero play time', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      const state = defaultState();
      applyTick(state, neutralCtx({ dtSec: bad }));
      expect(state.stats.playTimeSec).toBe(0);
    }
  });

  it('never leaves a non-finite value behind after a fully poisoned tick', () => {
    const state = defaultState();
    applyTick(state, neutralCtx({ dtSec: NaN, milesDelta: NaN }));
    applyTick(state, neutralCtx());
    expect(Number.isFinite(state.currencies.coins)).toBe(true);
    expect(Number.isFinite(state.stats.journeyMiles)).toBe(true);
    expect(Number.isFinite(state.stats.playTimeSec)).toBe(true);
  });
});

describe('initEconomy stat sanitization', () => {
  it('clamps non-finite and negative stats to zero', () => {
    const state = defaultState();
    state.stats.journeyMiles = Infinity; // "journeyMiles":1e309 in a crafted import
    state.stats.lifetimeMiles = -50;
    state.stats.topSpeed = NaN;
    state.stats.totalTokensEarned = Infinity;
    initEconomy(state);
    expect(state.stats.journeyMiles).toBe(0);
    expect(state.stats.lifetimeMiles).toBe(0);
    expect(state.stats.topSpeed).toBe(0);
    expect(state.stats.totalTokensEarned).toBe(0);
  });

  it('keeps the prestige preview finite after sanitizing a poisoned journey', () => {
    const state = defaultState();
    state.stats.journeyMiles = Infinity;
    initEconomy(state);
    const preview = getPrestigePreview(state);
    expect(Number.isFinite(preview.tokensOnPrestige)).toBe(true);
    expect(preview.canPrestige).toBe(false);
  });

  it('restores the visited/seen arrays when an import mangled them', () => {
    const state = defaultState();
    (state.stats as unknown as Record<string, unknown>).biomesVisited = 5;
    (state.stats as unknown as Record<string, unknown>).weatherSeen = null;
    initEconomy(state);
    expect(state.stats.biomesVisited).toEqual(['meadow']);
    expect(state.stats.weatherSeen).toEqual(['clear']);
  });
});
