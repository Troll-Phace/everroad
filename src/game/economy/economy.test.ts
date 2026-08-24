import { describe, it, expect } from 'vitest';
import { defaultState } from '../../state';
import {
  BASE_COINS_PER_MILE,
  BASE_COMBO_CAP,
  BASE_COMBO_DURATION,
  BASE_COMBO_GAIN,
  BASE_MAGNET_RADIUS,
  BASE_RELIC_CHANCE_PER_MILE,
  MAX_COMBO_CAP,
  PRESTIGE_BASE_MILES,
  PRESTIGE_MILES_GROWTH,
  PRESTIGE_TOKEN_EXPONENT,
  applyTick,
  buyCar,
  buyGlobalUpgrade,
  buyUpgrade,
  canAffordCar,
  doPrestige,
  getCarSpeed,
  getCoinRatePerMile,
  getComboCap,
  getComboDuration,
  getComboGainRate,
  getGlobalUpgradeCost,
  getIdleCoinsPerSec,
  getMagnetRadius,
  getOfflineRateFraction,
  getPickupCoinValue,
  getPrestigeMilesRequired,
  getPrestigePreview,
  getRelicChancePerMile,
  getUpgradeCost,
  getUpgradeLevel,
  initEconomy,
  selectCar,
} from './economy';
import { getCarDef } from './cars';
import { ENGINE_MPH_PER_LEVEL, HORIZON_FLOW_PER_LEVEL, headStartCoins } from './upgrades';
import { AUTOPILOT_CRUISE_FRACTION, type EconomyContext, type GameState } from '../../types';

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

/** A state with the given per-car part levels on the current car. */
function withParts(levels: Record<string, number>): GameState {
  const state = defaultState();
  state.upgrades[state.currentCarId] = { ...levels };
  return state;
}

function withGlobals(levels: Record<string, number>): GameState {
  const state = defaultState();
  state.globalUpgrades = { ...levels };
  return state;
}

// ---------------------------------------------------------------------------
// Speed
// ---------------------------------------------------------------------------

describe('getCarSpeed', () => {
  it('returns the starter car base speed on a fresh save', () => {
    // docs/ECONOMY.md car catalog: rusty-hatch baseSpeed 42.
    expect(getCarSpeed(defaultState())).toBe(42);
  });

  it('adds 2 mph per engine level', () => {
    expect(getCarSpeed(withParts({ engine: 1 }))).toBe(44);
    expect(getCarSpeed(withParts({ engine: 10 }))).toBe(62);
  });

  it('applies overdrive as a multiplier on top of engine levels', () => {
    // (42 + 2*10) * (1 + 0.05*4)
    const state = withParts({ engine: 10 });
    state.globalUpgrades = { overdrive: 4 };
    expect(getCarSpeed(state)).toBeCloseTo(62 * 1.2, 10);
  });

  it('reaches the documented ceiling at max engine and max overdrive', () => {
    const state = withParts({ engine: 25 });
    state.globalUpgrades = { overdrive: 20 };
    expect(getCarSpeed(state)).toBeCloseTo((42 + 50) * 2, 10);
  });

  it('ignores a negative or fractional stored level', () => {
    expect(getCarSpeed(withParts({ engine: -5 }))).toBe(42);
    expect(getCarSpeed(withParts({ engine: 3.9 }))).toBe(48); // floored to 3
  });

  it('falls back to the starter car for an unknown current car id', () => {
    const state = defaultState();
    state.currentCarId = 'delorean';
    expect(getCarSpeed(state)).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// Coin rate
// ---------------------------------------------------------------------------

describe('getCoinRatePerMile', () => {
  const neutral = { biomeId: 'meadow', timePhase: 'day', weatherId: 'clear' } as const;

  it('is the documented base rate for a fresh save in neutral conditions', () => {
    expect(getCoinRatePerMile(defaultState(), neutral)).toBe(BASE_COINS_PER_MILE);
    expect(BASE_COINS_PER_MILE).toBe(60);
  });

  it('scales by the car coinMult', () => {
    const state = defaultState();
    state.ownedCars.push('ember-gt');
    state.currentCarId = 'ember-gt';
    expect(getCoinRatePerMile(state, neutral)).toBeCloseTo(60 * getCarDef('ember-gt').coinMult, 10);
    expect(getCarDef('ember-gt').coinMult).toBe(3.5); // docs/ECONOMY.md catalog
  });

  it('adds 8% per tuning level, additively', () => {
    expect(getCoinRatePerMile(withParts({ tuning: 1 }), neutral)).toBeCloseTo(60 * 1.08, 10);
    expect(getCoinRatePerMile(withParts({ tuning: 25 }), neutral)).toBeCloseTo(60 * 3, 10);
  });

  it('adds 10% per horizon-flow level, additively', () => {
    expect(getCoinRatePerMile(withGlobals({ 'horizon-flow': 1 }), neutral)).toBeCloseTo(
      60 * 1.1,
      8,
    );
    expect(getCoinRatePerMile(withGlobals({ 'horizon-flow': 50 }), neutral)).toBeCloseTo(60 * 6, 8);
  });

  it.each([
    ['day', 1],
    ['night', 1],
    ['sunset', 1.15],
    ['dawn', 1.05],
  ] as const)('applies the %s phase multiplier', (timePhase, mult) => {
    expect(getCoinRatePerMile(defaultState(), { ...neutral, timePhase })).toBeCloseTo(
      60 * mult,
      10,
    );
  });

  it.each([
    ['clear', 1],
    ['rain', 1],
    ['fog', 1],
    ['leaves', 1.05],
    ['aurora', 1.5],
  ] as const)('applies the %s weather multiplier', (weatherId, mult) => {
    expect(getCoinRatePerMile(defaultState(), { ...neutral, weatherId })).toBeCloseTo(
      60 * mult,
      10,
    );
  });

  it('applies the autumn biome bonus and nothing for other biomes', () => {
    expect(getCoinRatePerMile(defaultState(), { ...neutral, biomeId: 'autumn' })).toBeCloseTo(
      60 * 1.1,
      10,
    );
    expect(getCoinRatePerMile(defaultState(), { ...neutral, biomeId: 'pine' })).toBe(60);
  });

  it('stacks the situational multipliers with each other', () => {
    // sunset x autumn x aurora — the best case in docs/ECONOMY.md.
    const rate = getCoinRatePerMile(defaultState(), {
      biomeId: 'autumn',
      timePhase: 'sunset',
      weatherId: 'aurora',
    });
    expect(rate).toBeCloseTo(60 * 1.15 * 1.1 * 1.5, 10);
  });

  it('stacks every multiplier axis at once', () => {
    const state = withParts({ tuning: 10 });
    state.globalUpgrades = { 'horizon-flow': 5 };
    state.ownedCars.push('commuter');
    state.currentCarId = 'commuter';
    state.upgrades.commuter = { tuning: 10 };
    const rate = getCoinRatePerMile(state, {
      biomeId: 'autumn',
      timePhase: 'dawn',
      weatherId: 'leaves',
    });
    expect(rate).toBeCloseTo(60 * 1.25 * (1 + 0.8) * (1 + 0.5) * 1.05 * 1.1 * 1.05, 8);
  });
});

// ---------------------------------------------------------------------------
// Tick
// ---------------------------------------------------------------------------

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

  it('scales earnings by the combo multiplier only while active', () => {
    const active = defaultState();
    applyTick(active, neutralCtx({ isActive: true, combo: 4, milesDelta: 1 }));
    expect(active.currencies.coins).toBeCloseTo(60 * 4, 9);

    const idle = defaultState();
    applyTick(idle, neutralCtx({ isActive: false, combo: 4, milesDelta: 1 }));
    expect(idle.currencies.coins).toBeCloseTo(60, 9);
  });

  it('floors a combo below 1 at 1 rather than shrinking earnings', () => {
    for (const combo of [0, 0.5, -3]) {
      const state = defaultState();
      applyTick(state, neutralCtx({ isActive: true, combo, milesDelta: 1 }));
      expect(state.currencies.coins).toBeCloseTo(60, 9);
    }
  });

  it('routes miles to active + journeyActive while steering', () => {
    const state = defaultState();
    applyTick(state, neutralCtx({ isActive: true, milesDelta: 2 }));
    expect(state.stats.activeMiles).toBe(2);
    expect(state.stats.journeyActiveMiles).toBe(2);
    expect(state.stats.idleMiles).toBe(0);
  });

  it('routes miles to idle while hands-off, leaving journeyActiveMiles at zero', () => {
    const state = defaultState();
    applyTick(state, neutralCtx({ isActive: false, milesDelta: 2 }));
    expect(state.stats.idleMiles).toBe(2);
    expect(state.stats.activeMiles).toBe(0);
    expect(state.stats.journeyActiveMiles).toBe(0);
  });

  it('accumulates lifetime and journey miles together', () => {
    const state = defaultState();
    applyTick(state, neutralCtx({ milesDelta: 1.5 }));
    applyTick(state, neutralCtx({ milesDelta: 2.5 }));
    expect(state.stats.lifetimeMiles).toBe(4);
    expect(state.stats.journeyMiles).toBe(4);
    expect(state.stats.lifetimeCoins).toBeCloseTo(4 * 60, 9);
  });

  it.each([
    ['night', 'nightMiles'],
    ['sunset', 'sunsetMiles'],
    ['dawn', 'dawnMiles'],
  ] as const)('books miles against the %s phase counter', (timePhase, key) => {
    const state = defaultState();
    applyTick(state, neutralCtx({ timePhase, milesDelta: 3 }));
    expect(state.stats[key]).toBe(3);
  });

  it('books no phase counter during the day', () => {
    const state = defaultState();
    applyTick(state, neutralCtx({ timePhase: 'day', milesDelta: 3 }));
    expect(state.stats.nightMiles + state.stats.sunsetMiles + state.stats.dawnMiles).toBe(0);
  });

  it.each([
    ['rain', 'rainMiles'],
    ['fog', 'fogMiles'],
    ['leaves', 'leafMiles'],
    ['aurora', 'auroraMiles'],
  ] as const)('books miles against the %s weather counter', (weatherId, key) => {
    const state = defaultState();
    applyTick(state, neutralCtx({ weatherId, milesDelta: 3 }));
    expect(state.stats[key]).toBe(3);
  });

  it('records newly seen biomes and weather exactly once', () => {
    const state = defaultState();
    applyTick(state, neutralCtx({ biomeId: 'pine', weatherId: 'rain' }));
    applyTick(state, neutralCtx({ biomeId: 'pine', weatherId: 'rain' }));
    applyTick(state, neutralCtx({ biomeId: 'autumn', weatherId: 'fog' }));
    expect(state.stats.biomesVisited).toEqual(['meadow', 'pine', 'autumn']);
    expect(state.stats.weatherSeen).toEqual(['clear', 'rain', 'fog']);
  });

  it('earns nothing for a zero-mile tick but still counts play time', () => {
    const state = defaultState();
    const tick = applyTick(state, neutralCtx({ milesDelta: 0, dtSec: 0.5 }));
    expect(tick.coinsEarned).toBe(0);
    expect(state.stats.playTimeSec).toBe(0.5);
  });

  it('treats a negative milesDelta as zero', () => {
    const state = defaultState();
    const tick = applyTick(state, neutralCtx({ milesDelta: -10 }));
    expect(tick.coinsEarned).toBe(0);
    expect(state.stats.journeyMiles).toBe(0);
    expect(state.stats.idleMiles).toBe(0);
  });

  it('treats a negative dtSec as zero play time', () => {
    const state = defaultState();
    applyTick(state, neutralCtx({ dtSec: -5 }));
    expect(state.stats.playTimeSec).toBe(0);
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

  // Regression: milesDelta and dtSec were guarded against non-finite input but
  // combo was not, and `Math.max(1, NaN)` is NaN — so an active tick with a NaN
  // combo permanently poisoned currencies.coins, stats.lifetimeCoins and every
  // downstream wealth achievement.
  it('treats a non-finite combo as 1 instead of poisoning coins', () => {
    const state = defaultState();
    applyTick(state, neutralCtx({ isActive: true, combo: NaN, milesDelta: 1 }));
    expect(Number.isFinite(state.currencies.coins)).toBe(true);
    expect(state.currencies.coins).toBeCloseTo(60, 9);
  });

  it('is additive across many ticks (state carries forward)', () => {
    const state = defaultState();
    for (let i = 0; i < 100; i++) applyTick(state, neutralCtx({ milesDelta: 0.01, dtSec: 1 }));
    expect(state.stats.journeyMiles).toBeCloseTo(1, 9);
    expect(state.stats.playTimeSec).toBe(100);
    expect(state.currencies.coins).toBeCloseTo(60, 6);
  });
});

// ---------------------------------------------------------------------------
// Idle / offline rate
// ---------------------------------------------------------------------------

describe('getOfflineRateFraction', () => {
  it('starts at 40% with no long-haul levels', () => {
    expect(getOfflineRateFraction(defaultState())).toBeCloseTo(0.4, 10);
  });

  it('adds 8% per long-haul level and reaches 120% at level 10', () => {
    expect(getOfflineRateFraction(withGlobals({ 'long-haul': 1 }))).toBeCloseTo(0.48, 10);
    expect(getOfflineRateFraction(withGlobals({ 'long-haul': 10 }))).toBeCloseTo(1.2, 10);
  });
});

describe('getIdleCoinsPerSec', () => {
  it('cruises at the autopilot fraction of the stated top speed', () => {
    // docs/ECONOMY.md: 42 mph x 0.94 = 39.48 mph -> 0.658 coins/sec live idle,
    // x 0.40 offline fraction = 0.263 coins/sec.
    expect(AUTOPILOT_CRUISE_FRACTION).toBe(0.94);
    const expected = ((42 * 0.94) / 3600) * 60 * 0.4;
    expect(getIdleCoinsPerSec(defaultState())).toBeCloseTo(expected, 12);
    expect(getIdleCoinsPerSec(defaultState())).toBeCloseTo(0.2632, 4);
  });

  it('is strictly below the rate a hands-on driver would earn at the same speed', () => {
    const state = defaultState();
    const uncruised = (getCarSpeed(state) / 3600) * 60 * getOfflineRateFraction(state);
    expect(getIdleCoinsPerSec(state)).toBeLessThan(uncruised);
    expect(getIdleCoinsPerSec(state)).toBeCloseTo(uncruised * AUTOPILOT_CRUISE_FRACTION, 12);
  });

  it('prices the baseline at the neutral context, never a bonus scene', () => {
    // The offline baseline must not depend on where the tab happened to close,
    // so it is priced at meadow/day/clear rather than at any situational bonus.
    const state = defaultState();
    const milesPerSec = (getCarSpeed(state) * AUTOPILOT_CRUISE_FRACTION) / 3600;
    const fraction = getOfflineRateFraction(state);
    const neutralRate = getCoinRatePerMile(state, {
      biomeId: 'meadow',
      timePhase: 'day',
      weatherId: 'clear',
    });
    const bonusRate = getCoinRatePerMile(state, {
      biomeId: 'autumn',
      timePhase: 'sunset',
      weatherId: 'aurora',
    });
    expect(bonusRate).toBeGreaterThan(neutralRate);
    expect(getIdleCoinsPerSec(state)).toBeCloseTo(milesPerSec * neutralRate * fraction, 12);
    expect(getIdleCoinsPerSec(state)).toBeLessThan(milesPerSec * bonusRate * fraction);
  });

  it('scales with speed, coin rate, and the offline fraction together', () => {
    const state = withParts({ engine: 5, tuning: 5 });
    state.globalUpgrades = { 'long-haul': 5, 'horizon-flow': 5 };
    const expected = (((42 + 10) * 0.94) / 3600) * (60 * 1.4 * 1.5) * (0.4 + 5 * 0.08);
    expect(getIdleCoinsPerSec(state)).toBeCloseTo(expected, 10);
  });
});

// ---------------------------------------------------------------------------
// Per-car upgrades
// ---------------------------------------------------------------------------

describe('getUpgradeLevel / getUpgradeCost', () => {
  it('reports level 0 for a car with no upgrade record', () => {
    const state = defaultState();
    expect(getUpgradeLevel(state, 'ember-gt', 'engine')).toBe(0);
    expect(getUpgradeLevel(state, 'rusty-hatch', 'engine')).toBe(0);
  });

  it.each([
    ['engine', 15, 1.55],
    ['tuning', 20, 1.6],
    ['tires', 40, 1.65],
    ['magnet', 60, 1.7],
    ['chime', 80, 1.75],
  ] as const)('prices %s from the docs/ECONOMY.md table', (kind, base, growth) => {
    const state = defaultState();
    expect(getUpgradeCost(state, 'rusty-hatch', kind)).toBe(base);
    const leveled = withParts({ [kind]: 3 });
    expect(getUpgradeCost(leveled, leveled.currentCarId, kind)).toBe(
      Math.ceil(base * Math.pow(growth, 3)),
    );
  });

  it('returns Infinity at the max level', () => {
    expect(getUpgradeCost(withParts({ engine: 25 }), 'rusty-hatch', 'engine')).toBe(Infinity);
    expect(getUpgradeCost(withParts({ magnet: 10 }), 'rusty-hatch', 'magnet')).toBe(Infinity);
  });

  it('applies the quick-spool discount', () => {
    const state = withParts({ engine: 0 });
    state.globalUpgrades = { 'quick-spool': 15 }; // max: -30%
    expect(getUpgradeCost(state, 'rusty-hatch', 'engine')).toBe(Math.ceil(15 * 0.7));
  });
});

describe('buyUpgrade', () => {
  it('deducts the exact cost and raises the level', () => {
    const state = defaultState();
    state.currencies.coins = 100;
    expect(buyUpgrade(state, 'rusty-hatch', 'engine')).toBe(true);
    expect(state.currencies.coins).toBe(85);
    expect(getUpgradeLevel(state, 'rusty-hatch', 'engine')).toBe(1);
    expect(state.stats.upgradesPurchased).toBe(1);
  });

  it('buys exactly at the affordability boundary', () => {
    const state = defaultState();
    state.currencies.coins = 15;
    expect(buyUpgrade(state, 'rusty-hatch', 'engine')).toBe(true);
    expect(state.currencies.coins).toBe(0);
  });

  it('rejects a purchase one coin short and leaves the state untouched', () => {
    const state = defaultState();
    state.currencies.coins = 14;
    const before = structuredClone(state);
    expect(buyUpgrade(state, 'rusty-hatch', 'engine')).toBe(false);
    expect(state).toEqual(before);
  });

  it('rejects an upgrade for a car the player does not own', () => {
    const state = defaultState();
    state.currencies.coins = 1e9;
    expect(buyUpgrade(state, 'ember-gt', 'engine')).toBe(false);
    expect(state.currencies.coins).toBe(1e9);
    expect(state.upgrades['ember-gt']).toBeUndefined();
  });

  it('refuses to exceed the level cap however many coins are on hand', () => {
    const state = withParts({ magnet: 9 });
    state.currencies.coins = 1e12;
    expect(buyUpgrade(state, 'rusty-hatch', 'magnet')).toBe(true);
    expect(getUpgradeLevel(state, 'rusty-hatch', 'magnet')).toBe(10);
    const coinsAtCap = state.currencies.coins;
    expect(buyUpgrade(state, 'rusty-hatch', 'magnet')).toBe(false);
    expect(getUpgradeLevel(state, 'rusty-hatch', 'magnet')).toBe(10);
    expect(state.currencies.coins).toBe(coinsAtCap);
    expect(state.stats.upgradesPurchased).toBe(1);
  });

  it('charges the escalating cost curve on successive buys', () => {
    const state = defaultState();
    state.currencies.coins = 1000;
    let spent = 0;
    for (let level = 0; level < 5; level++) {
      const cost = getUpgradeCost(state, 'rusty-hatch', 'engine');
      expect(cost).toBe(Math.ceil(15 * Math.pow(1.55, level)));
      spent += cost;
      expect(buyUpgrade(state, 'rusty-hatch', 'engine')).toBe(true);
    }
    expect(state.currencies.coins).toBe(1000 - spent);
    expect(getUpgradeLevel(state, 'rusty-hatch', 'engine')).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Global (Horizon shop) upgrades
// ---------------------------------------------------------------------------

describe('getGlobalUpgradeCost / buyGlobalUpgrade', () => {
  it.each([
    ['horizon-flow', 1, 1.6],
    ['long-haul', 2, 1.6],
    ['momentum', 2, 1.6],
    ['head-start', 1, 1.7],
    ['token-magnet', 3, 1.6],
    ['keen-eye', 2, 1.6],
    ['overdrive', 3, 1.65],
    ['quick-spool', 2, 1.6],
  ])('prices %s from the docs/ECONOMY.md table', (id, base, growth) => {
    expect(getGlobalUpgradeCost(defaultState(), id)).toBe(base);
    expect(getGlobalUpgradeCost(withGlobals({ [id]: 4 }), id)).toBe(
      Math.ceil(base * Math.pow(growth, 4)),
    );
  });

  it('returns Infinity for an unknown id and refuses to buy it', () => {
    const state = defaultState();
    state.currencies.tokens = 1e6;
    expect(getGlobalUpgradeCost(state, 'free-money')).toBe(Infinity);
    expect(buyGlobalUpgrade(state, 'free-money')).toBe(false);
    expect(state.globalUpgrades['free-money']).toBeUndefined();
    expect(state.currencies.tokens).toBe(1e6);
  });

  it('returns Infinity at the max level and refuses the purchase', () => {
    const state = withGlobals({ 'long-haul': 10 });
    state.currencies.tokens = 1e6;
    expect(getGlobalUpgradeCost(state, 'long-haul')).toBe(Infinity);
    expect(buyGlobalUpgrade(state, 'long-haul')).toBe(false);
    expect(state.globalUpgrades['long-haul']).toBe(10);
  });

  it('deducts tokens and raises the level on a successful buy', () => {
    const state = defaultState();
    state.currencies.tokens = 5;
    expect(buyGlobalUpgrade(state, 'long-haul')).toBe(true);
    expect(state.currencies.tokens).toBe(3);
    expect(state.globalUpgrades['long-haul']).toBe(1);
  });

  it('rejects a purchase one token short and leaves the state untouched', () => {
    const state = defaultState();
    state.currencies.tokens = 1;
    const before = structuredClone(state);
    expect(buyGlobalUpgrade(state, 'long-haul')).toBe(false);
    expect(state).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// Cars
// ---------------------------------------------------------------------------

describe('canAffordCar / buyCar / selectCar', () => {
  it('is unaffordable with no coins and affordable at the exact price', () => {
    const state = defaultState();
    expect(canAffordCar(state, 'commuter')).toBe(false);
    state.currencies.coins = 399;
    expect(canAffordCar(state, 'commuter')).toBe(false);
    state.currencies.coins = 400;
    expect(canAffordCar(state, 'commuter')).toBe(true);
  });

  it('reports an unknown car and an already-owned car as unaffordable', () => {
    const state = defaultState();
    state.currencies.coins = 1e12;
    expect(canAffordCar(state, 'delorean')).toBe(false);
    expect(canAffordCar(state, 'rusty-hatch')).toBe(false);
  });

  it('buys a coin car, deducting coins and creating its upgrade record', () => {
    const state = defaultState();
    state.currencies.coins = 500;
    expect(buyCar(state, 'commuter')).toBe(true);
    expect(state.currencies.coins).toBe(100);
    expect(state.ownedCars).toContain('commuter');
    expect(state.upgrades.commuter).toEqual({});
  });

  it('buys a relic car with relics, not coins', () => {
    const state = defaultState();
    state.currencies.relics = 12;
    state.currencies.coins = 0;
    expect(buyCar(state, 'petal-roadster')).toBe(true);
    expect(state.currencies.relics).toBe(0);
    expect(state.currencies.coins).toBe(0);
  });

  it('buys the token car with tokens', () => {
    const state = defaultState();
    state.currencies.tokens = 200;
    expect(buyCar(state, 'auroracraft')).toBe(true);
    expect(state.currencies.tokens).toBe(0);
    expect(state.ownedCars).toContain('auroracraft');
  });

  it('leaves the state untouched when the purchase fails', () => {
    const state = defaultState();
    state.currencies.coins = 399;
    const before = structuredClone(state);
    expect(buyCar(state, 'commuter')).toBe(false);
    expect(buyCar(state, 'delorean')).toBe(false);
    expect(buyCar(state, 'rusty-hatch')).toBe(false);
    expect(state).toEqual(before);
  });

  it('selects an owned car and refuses an unowned one', () => {
    const state = defaultState();
    expect(selectCar(state, 'ember-gt')).toBe(false);
    expect(state.currentCarId).toBe('rusty-hatch');
    state.currencies.coins = 400;
    buyCar(state, 'commuter');
    expect(selectCar(state, 'commuter')).toBe(true);
    expect(state.currentCarId).toBe('commuter');
    expect(state.upgrades.commuter).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Prestige
// ---------------------------------------------------------------------------

describe('getPrestigeMilesRequired', () => {
  it('starts at 25 miles and grows 1.35x per prestige', () => {
    const state = defaultState();
    expect(getPrestigeMilesRequired(state)).toBe(PRESTIGE_BASE_MILES);
    for (const [count, expected] of [
      [1, 33.75],
      [2, 45.5625],
      [3, 61.509375],
    ] as const) {
      state.stats.prestigeCount = count;
      expect(getPrestigeMilesRequired(state)).toBeCloseTo(expected, 6);
    }
    expect(PRESTIGE_MILES_GROWTH).toBe(1.35);
  });
});

describe('getPrestigePreview', () => {
  it('reports no tokens and no prestige below the gate', () => {
    const state = defaultState();
    state.stats.journeyMiles = 24.99;
    expect(getPrestigePreview(state)).toEqual({
      tokensOnPrestige: 0,
      milesRequired: 25,
      canPrestige: false,
    });
  });

  it('awards exactly one token at the gate boundary', () => {
    const state = defaultState();
    state.stats.journeyMiles = 25;
    const preview = getPrestigePreview(state);
    expect(preview.canPrestige).toBe(true);
    expect(preview.tokensOnPrestige).toBe(1);
  });

  it('follows the 0.85-exponent curve so overshooting is sublinear', () => {
    const state = defaultState();
    state.stats.journeyMiles = 100;
    // (100/25)^0.85 = 3.2489 -> 3, not the linear 4.
    expect(getPrestigePreview(state).tokensOnPrestige).toBe(3);
    expect(PRESTIGE_TOKEN_EXPONENT).toBe(0.85);

    state.stats.journeyMiles = 2500;
    expect(getPrestigePreview(state).tokensOnPrestige).toBe(Math.floor(Math.pow(100, 0.85)));
  });

  it('adds 10% per token-magnet level', () => {
    const state = withGlobals({ 'token-magnet': 5 });
    state.stats.journeyMiles = 100;
    expect(getPrestigePreview(state).tokensOnPrestige).toBe(Math.floor(Math.pow(4, 0.85) * 1.5));
  });

  it('pays the exact curve value when the gate is met precisely', () => {
    // Meeting a gate exactly is the boundary the formula's Math.max(1, ...) was
    // written for, and it is unreachable: journeyMiles >= milesRequired >= 25
    // makes the 0.85-curve land on 1 at the very first gate and climb from
    // there. Assert the curve, not the floor.
    const first = defaultState();
    first.stats.journeyMiles = PRESTIGE_BASE_MILES;
    expect(getPrestigePreview(first)).toEqual({
      tokensOnPrestige: 1,
      milesRequired: PRESTIGE_BASE_MILES,
      canPrestige: true,
    });

    // The 21st journey: gate = 25 x 1.35^20 miles, paying floor(1.35^17) = 164.
    const veteran = defaultState();
    veteran.stats.prestigeCount = 20;
    veteran.stats.journeyMiles = getPrestigeMilesRequired(veteran);
    expect(getPrestigePreview(veteran).tokensOnPrestige).toBe(164);
  });
});

describe('doPrestige', () => {
  /** A well-worn journey, ready to prestige. */
  function veteranState(): GameState {
    const state = defaultState();
    state.currencies = { coins: 50_000, tokens: 9, relics: 4 };
    state.ownedCars = ['rusty-hatch', 'commuter', 'ember-gt'];
    state.currentCarId = 'ember-gt';
    state.upgrades = {
      'rusty-hatch': { engine: 5, tuning: 4 },
      commuter: { engine: 12, tires: 3 },
      'ember-gt': { engine: 20, tuning: 15, magnet: 6, chime: 4 },
    };
    state.globalUpgrades = { 'horizon-flow': 4, 'token-magnet': 2, overdrive: 3 };
    state.achievements = ['first-mile', 'open-road'];
    state.stats.journeyMiles = 100;
    state.stats.journeyActiveMiles = 40;
    state.stats.lifetimeMiles = 5000;
    state.stats.activeMiles = 1200;
    state.stats.lifetimeCoins = 900_000;
    state.stats.upgradesPurchased = 60;
    state.stats.prestigeCount = 0;
    state.stats.totalTokensEarned = 9;
    state.stats.playTimeSec = 7200;
    state.stats.bestCombo = 6;
    return state;
  }

  it('returns 0 and changes nothing below the gate', () => {
    const state = veteranState();
    state.stats.journeyMiles = 24.99;
    const before = structuredClone(state);
    expect(doPrestige(state)).toBe(0);
    expect(state).toEqual(before);
  });

  it('awards the previewed tokens and counts them as earned', () => {
    const state = veteranState();
    const expected = getPrestigePreview(state).tokensOnPrestige;
    expect(doPrestige(state)).toBe(expected);
    expect(state.currencies.tokens).toBe(9 + expected);
    expect(state.stats.totalTokensEarned).toBe(9 + expected);
    expect(state.stats.prestigeCount).toBe(1);
  });

  it('resets exactly the journey fields and nothing else', () => {
    const state = veteranState();
    const before = structuredClone(state);
    const gained = doPrestige(state);

    // Reset.
    expect(state.stats.journeyMiles).toBe(0);
    expect(state.stats.journeyActiveMiles).toBe(0);
    expect(state.currencies.coins).toBe(headStartCoins(0));
    expect(state.currencies.coins).toBe(0);
    for (const carId of Object.keys(state.upgrades)) {
      expect(state.upgrades[carId], `upgrades.${carId} should be cleared`).toEqual({});
    }

    // Changed by the award.
    expect(state.currencies.tokens).toBe(before.currencies.tokens + gained);
    expect(state.stats.totalTokensEarned).toBe(before.stats.totalTokensEarned + gained);
    expect(state.stats.prestigeCount).toBe(before.stats.prestigeCount + 1);

    // Kept, field by field — this is where prestige bugs hide.
    expect(state.currencies.relics).toBe(before.currencies.relics);
    expect(state.ownedCars).toEqual(before.ownedCars);
    expect(state.currentCarId).toBe(before.currentCarId);
    expect(state.globalUpgrades).toEqual(before.globalUpgrades);
    expect(state.achievements).toEqual(before.achievements);
    expect(state.settings).toEqual(before.settings);
    expect(state.version).toBe(before.version);
    expect(state.createdTime).toBe(before.createdTime);
    expect(state.lastSaveTime).toBe(before.lastSaveTime);

    const changedStats = new Set([
      'journeyMiles',
      'journeyActiveMiles',
      'totalTokensEarned',
      'prestigeCount',
    ]);
    for (const key of Object.keys(before.stats) as (keyof typeof before.stats)[]) {
      if (changedStats.has(key)) continue;
      expect(state.stats[key], `stats.${key} must survive prestige`).toEqual(before.stats[key]);
    }
  });

  it('clears the upgrade record of unowned cars too, so a re-buy is not pre-upgraded', () => {
    const state = veteranState();
    state.ownedCars = ['rusty-hatch'];
    state.currentCarId = 'rusty-hatch';
    doPrestige(state);
    expect(state.upgrades['ember-gt']).toEqual({});
    expect(state.upgrades.commuter).toEqual({});
  });

  it('seeds the head-start coin grant from the global level', () => {
    const state = veteranState();
    state.globalUpgrades['head-start'] = 3;
    doPrestige(state);
    // 250 * 3 * 2^2
    expect(state.currencies.coins).toBe(3000);
    expect(state.currencies.coins).toBe(headStartCoins(3));
  });

  it('raises the gate for the next journey', () => {
    const state = veteranState();
    doPrestige(state);
    expect(getPrestigeMilesRequired(state)).toBeCloseTo(25 * 1.35, 10);
    expect(getPrestigePreview(state).canPrestige).toBe(false);
  });

  it('chains across repeated journeys', () => {
    const state = veteranState();
    let totalGained = 0;
    for (let i = 0; i < 3; i++) {
      state.stats.journeyMiles = 500;
      totalGained += doPrestige(state);
    }
    expect(state.stats.prestigeCount).toBe(3);
    expect(state.stats.totalTokensEarned).toBe(9 + totalGained);
    expect(state.stats.lifetimeMiles).toBe(5000); // never reset
  });
});

// ---------------------------------------------------------------------------
// Pickups / relics / combo helpers
// ---------------------------------------------------------------------------

describe('pickup, relic, magnet and combo helpers', () => {
  it('values a pickup at ~2 seconds of neutral cruising income, minimum 1', () => {
    const state = defaultState();
    // (42/3600)*60 = 0.7 coins/sec, x2 sec = 1.4 -> ceil 2.
    expect(getPickupCoinValue(state, 1)).toBe(2);
    expect(getPickupCoinValue(state, 0)).toBe(2); // combo floored at 1
    expect(getPickupCoinValue(state, 8)).toBe(Math.ceil(0.7 * 2 * 8));
  });

  it('falls back to the starter car when the current car id is unknown', () => {
    // getCarDef falls back to the starter, so the value is the starter's — the
    // Math.max(1, ...) floor below it is unreachable (ceil of a positive is
    // already >= 1), which is why this asserts the number rather than the floor.
    const state = defaultState();
    state.currentCarId = 'delorean';
    expect(getPickupCoinValue(state, 1)).toBe(2);
    expect(getPickupCoinValue(state, 1)).toBe(getPickupCoinValue(defaultState(), 1));
  });

  it('scales relic chance with chime and keen-eye', () => {
    expect(getRelicChancePerMile(defaultState())).toBeCloseTo(BASE_RELIC_CHANCE_PER_MILE, 12);
    const state = withParts({ chime: 10 });
    state.globalUpgrades = { 'keen-eye': 15 };
    expect(getRelicChancePerMile(state)).toBeCloseTo(0.008 * 2.5 * 3.25, 12);
  });

  it('grows the magnet radius by 0.7 m per level', () => {
    expect(getMagnetRadius(defaultState())).toBe(BASE_MAGNET_RADIUS);
    expect(getMagnetRadius(withParts({ magnet: 10 }))).toBeCloseTo(9.5, 10);
  });

  it('raises the combo cap with tires but never past the hard cap', () => {
    expect(getComboCap(defaultState())).toBe(BASE_COMBO_CAP);
    expect(getComboCap(withParts({ tires: 4 }))).toBe(4);
    expect(getComboCap(withParts({ tires: 12 }))).toBe(MAX_COMBO_CAP);
    expect(getComboCap(withParts({ tires: 15 }))).toBe(MAX_COMBO_CAP);
  });

  it('raises combo gain with tires', () => {
    expect(getComboGainRate(defaultState())).toBeCloseTo(BASE_COMBO_GAIN, 12);
    expect(getComboGainRate(withParts({ tires: 15 }))).toBeCloseTo(0.7, 12);
  });

  it('extends combo duration by 1 s per momentum level', () => {
    expect(getComboDuration(defaultState())).toBe(BASE_COMBO_DURATION);
    expect(getComboDuration(withGlobals({ momentum: 10 }))).toBe(15);
  });
});

// ---------------------------------------------------------------------------
// initEconomy
// ---------------------------------------------------------------------------

describe('initEconomy', () => {
  it('leaves a fresh default state untouched', () => {
    const state = defaultState();
    const before = structuredClone(state);
    initEconomy(state);
    expect(state).toEqual(before);
  });

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

  it('sanitizes currencies', () => {
    const state = defaultState();
    state.currencies = { coins: -1, tokens: NaN, relics: Infinity };
    initEconomy(state);
    expect(state.currencies).toEqual({ coins: 0, tokens: 0, relics: 0 });
  });

  it('always restores the starter car and drops unknown ids', () => {
    const state = defaultState();
    state.ownedCars = ['delorean', 'commuter'];
    initEconomy(state);
    expect(state.ownedCars).toEqual(['rusty-hatch', 'commuter']);
  });

  it('gives every owned car an upgrade record', () => {
    const state = defaultState();
    state.ownedCars = ['rusty-hatch', 'commuter', 'ember-gt'];
    state.upgrades = {};
    initEconomy(state);
    expect(Object.keys(state.upgrades).sort()).toEqual(['commuter', 'ember-gt', 'rusty-hatch']);
  });

  it('repairs a current car the player does not own', () => {
    const state = defaultState();
    state.ownedCars = ['rusty-hatch', 'commuter'];

    state.currentCarId = 'ember-gt'; // a real car, never bought
    initEconomy(state);
    expect(state.currentCarId).toBe('rusty-hatch');

    state.currentCarId = 'delorean'; // not a car at all
    initEconomy(state);
    expect(state.currentCarId).toBe('rusty-hatch');

    // An owned car is left where the player put it.
    state.currentCarId = 'commuter';
    initEconomy(state);
    expect(state.currentCarId).toBe('commuter');
  });

  it('clamps per-car part levels into [0, maxLevel]', () => {
    const state = defaultState();
    state.ownedCars = ['rusty-hatch', 'commuter'];
    state.upgrades = {
      'rusty-hatch': { engine: 999, tuning: -3, tires: 4.7 },
      commuter: { magnet: 50, chime: NaN },
    };
    initEconomy(state);
    // maxLevels from UPGRADES: engine/tuning 25, tires 15, magnet/chime 10.
    expect(state.upgrades['rusty-hatch']).toEqual({ engine: 25, tuning: 0, tires: 4 });
    expect(state.upgrades.commuter).toEqual({ magnet: 10, chime: 0 });
    // ...and the clamped level is what the rates then read.
    expect(getCarSpeed(state)).toBe(42 + 25 * ENGINE_MPH_PER_LEVEL);
  });

  it('clamps global upgrade levels to their max and deletes unknown ids', () => {
    // The threat is a hand-edited save: horizon-flow 999 is a ~+9,990% coin
    // multiplier if the clamp is skipped, against the +400% the shop can sell.
    const state = defaultState();
    state.globalUpgrades = { 'horizon-flow': 999, 'long-haul': -4, overdrive: 7.9, nope: 1 };
    initEconomy(state);
    expect(state.globalUpgrades).toEqual({
      'horizon-flow': 50, // maxLevel
      'long-haul': 0, // negatives floor at 0
      overdrive: 7, // fractional levels floor, they do not round
    });
    expect(state.globalUpgrades.nope).toBeUndefined();
    expect(getCoinRatePerMile(state, neutralCtx())).toBeCloseTo(
      BASE_COINS_PER_MILE * (1 + 50 * HORIZON_FLOW_PER_LEVEL),
      8,
    );
  });

  it('is idempotent', () => {
    const state = defaultState();
    state.ownedCars = ['delorean', 'commuter'];
    state.globalUpgrades = { 'horizon-flow': 999, nope: 1 };
    initEconomy(state);
    const once = structuredClone(state);
    initEconomy(state);
    expect(state).toEqual(once);
  });
});
