/**
 * Everroad — economy core.
 *
 * Pure logic: earning rates, tick application, purchases, prestige.
 * All functions operate on the shared GameState; applyTick and the buy/
 * prestige functions mutate it in place, everything else is read-only.
 *
 * Tuning constants live at the top; the reasoning behind the numbers is in
 * docs/ECONOMY.md.
 */

import {
  AUTOPILOT_CRUISE_FRACTION,
  type EconomyContext,
  type GameState,
  type PrestigePreview,
  type TickResult,
  type UpgradeKind,
} from '../../types';
import { CARS, STARTER_CAR_ID, getCarDef } from './cars';
import {
  CHIME_RELIC_PER_LEVEL,
  ENGINE_MPH_PER_LEVEL,
  HORIZON_FLOW_PER_LEVEL,
  KEEN_EYE_PER_LEVEL,
  LONG_HAUL_BASE,
  LONG_HAUL_PER_LEVEL,
  MAGNET_RADIUS_PER_LEVEL,
  MOMENTUM_SEC_PER_LEVEL,
  OVERDRIVE_PER_LEVEL,
  QUICK_SPOOL_PER_LEVEL,
  TIRES_CAP_PER_LEVEL,
  TIRES_GAIN_PER_LEVEL,
  TOKEN_MAGNET_PER_LEVEL,
  TUNING_MULT_PER_LEVEL,
  UPGRADES,
  getGlobalUpgradeDef,
  getUpgradeDef,
  headStartCoins,
} from './upgrades';

// ---------------------------------------------------------------------------
// Tuning constants
// ---------------------------------------------------------------------------

/** Coins earned per mile at multiplier 1 (starter car, no upgrades, neutral). */
export const BASE_COINS_PER_MILE = 60;

/** Prestige gate: miles required for the first prestige. */
export const PRESTIGE_BASE_MILES = 25;
/** Each completed prestige scales the mile gate by this factor. */
export const PRESTIGE_MILES_GROWTH = 1.35;
/** Exponent that softens token gain vs. journey miles. */
export const PRESTIGE_TOKEN_EXPONENT = 0.85;

/** Base chance to spot a relic, per mile driven. */
export const BASE_RELIC_CHANCE_PER_MILE = 0.008;
/** Base pickup attraction radius (meters). */
export const BASE_MAGNET_RADIUS = 2.5;
/** Base combo cap without tires. */
export const BASE_COMBO_CAP = 2;
/** Absolute combo cap regardless of upgrades. */
export const MAX_COMBO_CAP = 8;
/** Base combo gained per second of continuous styling. */
export const BASE_COMBO_GAIN = 0.25;
/** Base seconds before an idle combo starts decaying. */
export const BASE_COMBO_DURATION = 5;
/** A pickup is worth about this many seconds of cruising income. */
export const PICKUP_VALUE_SECONDS = 2;

// Situational coin-rate bonuses (small, flavorful nudges).
const SUNSET_BONUS = 1.15;
const DAWN_BONUS = 1.05;
const AUTUMN_BONUS = 1.1;
const AURORA_BONUS = 1.5;
const LEAVES_BONUS = 1.05;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function globalLevel(state: GameState, id: string): number {
  const lvl = state.globalUpgrades[id];
  return typeof lvl === 'number' && lvl > 0 ? Math.floor(lvl) : 0;
}

function clampInt(n: unknown, min: number, max: number): number {
  const v = typeof n === 'number' && isFinite(n) ? Math.floor(n) : min;
  return Math.min(max, Math.max(min, v));
}

function sanitizeNumber(n: unknown, fallback = 0): number {
  return typeof n === 'number' && isFinite(n) && n >= 0 ? n : fallback;
}

// ---------------------------------------------------------------------------
// Init / repair
// ---------------------------------------------------------------------------

/**
 * Normalize/repair a loaded (or freshly created) state so the rest of the
 * economy can assume its invariants: starter car owned, current car owned,
 * an upgrade record per owned car, levels within bounds, sane balances.
 */
export function initEconomy(state: GameState): void {
  // Currencies must be finite and non-negative.
  state.currencies.coins = sanitizeNumber(state.currencies.coins);
  state.currencies.tokens = sanitizeNumber(state.currencies.tokens);
  state.currencies.relics = sanitizeNumber(state.currencies.relics);

  // Stats must be finite and non-negative too — a poisoned import (e.g.
  // "journeyMiles":1e309 parsing to Infinity) would otherwise mint infinite
  // prestige tokens. Arrays keep their shape; every other field is numeric.
  const stats = state.stats as unknown as Record<string, unknown>;
  for (const key of Object.keys(stats)) {
    if (!Array.isArray(stats[key])) stats[key] = sanitizeNumber(stats[key]);
  }
  if (!Array.isArray(state.stats.biomesVisited)) state.stats.biomesVisited = ['meadow'];
  if (!Array.isArray(state.stats.weatherSeen)) state.stats.weatherSeen = ['clear'];

  // Starter car is always owned; drop unknown car ids.
  if (!Array.isArray(state.ownedCars)) state.ownedCars = [];
  state.ownedCars = state.ownedCars.filter((id) => CARS.some((c) => c.id === id));
  if (!state.ownedCars.includes(STARTER_CAR_ID)) {
    state.ownedCars.unshift(STARTER_CAR_ID);
  }

  // Current car must be an owned car.
  if (!state.ownedCars.includes(state.currentCarId)) {
    state.currentCarId = STARTER_CAR_ID;
  }

  // Every owned car needs an upgrade record; clamp levels to [0, maxLevel].
  if (typeof state.upgrades !== 'object' || state.upgrades === null) {
    state.upgrades = {};
  }
  for (const carId of state.ownedCars) {
    const rec = state.upgrades[carId] ?? {};
    for (const def of UPGRADES) {
      const lvl = rec[def.id];
      if (lvl !== undefined) {
        rec[def.id] = clampInt(lvl, 0, def.maxLevel);
      }
    }
    state.upgrades[carId] = rec;
  }

  // Clamp global upgrade levels; drop unknown ids.
  if (typeof state.globalUpgrades !== 'object' || state.globalUpgrades === null) {
    state.globalUpgrades = {};
  }
  for (const id of Object.keys(state.globalUpgrades)) {
    const def = getGlobalUpgradeDef(id);
    if (!def) {
      delete state.globalUpgrades[id];
    } else {
      state.globalUpgrades[id] = clampInt(state.globalUpgrades[id], 0, def.maxLevel);
    }
  }
}

// ---------------------------------------------------------------------------
// Rates
// ---------------------------------------------------------------------------

/** Effective cruising speed of the current car (mph), with engine + overdrive. */
export function getCarSpeed(state: GameState): number {
  const car = getCarDef(state.currentCarId);
  const engine = getUpgradeLevel(state, state.currentCarId, 'engine');
  const overdrive = globalLevel(state, 'overdrive');
  const raw = car.baseSpeed + engine * ENGINE_MPH_PER_LEVEL;
  return raw * (1 + overdrive * OVERDRIVE_PER_LEVEL);
}

/**
 * Coins earned per mile in the given world context (combo NOT included —
 * applyTick layers combo on top for active play).
 */
export function getCoinRatePerMile(
  state: GameState,
  ctx: Pick<EconomyContext, 'biomeId' | 'timePhase' | 'weatherId'>,
): number {
  const car = getCarDef(state.currentCarId);
  const tuning = getUpgradeLevel(state, state.currentCarId, 'tuning');
  const flow = globalLevel(state, 'horizon-flow');

  let situational = 1;
  if (ctx.timePhase === 'sunset') situational *= SUNSET_BONUS;
  else if (ctx.timePhase === 'dawn') situational *= DAWN_BONUS;
  if (ctx.biomeId === 'autumn') situational *= AUTUMN_BONUS;
  if (ctx.weatherId === 'aurora') situational *= AURORA_BONUS;
  else if (ctx.weatherId === 'leaves') situational *= LEAVES_BONUS;

  return (
    BASE_COINS_PER_MILE *
    car.coinMult *
    (1 + tuning * TUNING_MULT_PER_LEVEL) *
    (1 + flow * HORIZON_FLOW_PER_LEVEL) *
    situational
  );
}

const NEUTRAL_CTX: Pick<EconomyContext, 'biomeId' | 'timePhase' | 'weatherId'> = {
  biomeId: 'meadow',
  timePhase: 'day',
  weatherId: 'clear',
};

/** Fraction of the live idle rate earned while offline (long-haul). */
export function getOfflineRateFraction(state: GameState): number {
  return LONG_HAUL_BASE + globalLevel(state, 'long-haul') * LONG_HAUL_PER_LEVEL;
}

/**
 * Passive baseline coins/sec, used for offline progress:
 * cruising speed (miles/sec) x neutral coin rate x offline rate fraction.
 */
export function getIdleCoinsPerSec(state: GameState): number {
  // Hands-off play cruises at AUTOPILOT_CRUISE_FRACTION of the car's stated
  // speed, so the idle baseline must too — otherwise offline projections run
  // ahead of what the same time spent watching would have earned.
  const milesPerSec = (getCarSpeed(state) * AUTOPILOT_CRUISE_FRACTION) / 3600;
  return milesPerSec * getCoinRatePerMile(state, NEUTRAL_CTX) * getOfflineRateFraction(state);
}

// ---------------------------------------------------------------------------
// Tick
// ---------------------------------------------------------------------------

/**
 * Apply one economy tick: earn coins for the miles driven and update stats.
 * Mutates state in place.
 */
export function applyTick(state: GameState, ctx: EconomyContext): TickResult {
  // A single NaN milesDelta, dtSec, or combo would poison coins/miles/playTime
  // permanently (Math.max(0, NaN) is NaN), so non-finite inputs earn nothing.
  const miles = Number.isFinite(ctx.milesDelta) ? Math.max(0, ctx.milesDelta) : 0;
  const dtSec = Number.isFinite(ctx.dtSec) ? Math.max(0, ctx.dtSec) : 0;
  const combo = ctx.isActive && Number.isFinite(ctx.combo) ? Math.max(1, ctx.combo) : 1;
  const coinsEarned = miles * getCoinRatePerMile(state, ctx) * combo;

  state.currencies.coins += coinsEarned;

  const s = state.stats;
  s.journeyMiles += miles;
  s.lifetimeMiles += miles;
  s.lifetimeCoins += coinsEarned;
  s.playTimeSec += dtSec;

  if (ctx.isActive) {
    s.activeMiles += miles;
    s.journeyActiveMiles += miles;
  } else {
    s.idleMiles += miles;
  }

  switch (ctx.timePhase) {
    case 'night':
      s.nightMiles += miles;
      break;
    case 'sunset':
      s.sunsetMiles += miles;
      break;
    case 'dawn':
      s.dawnMiles += miles;
      break;
    case 'day':
      break;
  }

  switch (ctx.weatherId) {
    case 'rain':
      s.rainMiles += miles;
      break;
    case 'fog':
      s.fogMiles += miles;
      break;
    case 'leaves':
      s.leafMiles += miles;
      break;
    case 'aurora':
      s.auroraMiles += miles;
      break;
    case 'clear':
      break;
  }

  if (!s.biomesVisited.includes(ctx.biomeId)) s.biomesVisited.push(ctx.biomeId);
  if (!s.weatherSeen.includes(ctx.weatherId)) s.weatherSeen.push(ctx.weatherId);

  return { coinsEarned };
}

// ---------------------------------------------------------------------------
// Per-car upgrades
// ---------------------------------------------------------------------------

export function getUpgradeLevel(state: GameState, carId: string, upgradeId: UpgradeKind): number {
  const rec = state.upgrades[carId];
  if (!rec) return 0;
  const lvl = rec[upgradeId];
  return typeof lvl === 'number' && lvl > 0 ? Math.floor(lvl) : 0;
}

/** Cost of the next level of a part (Infinity at max). Quick-spool applies. */
export function getUpgradeCost(state: GameState, carId: string, upgradeId: UpgradeKind): number {
  const def = getUpgradeDef(upgradeId);
  const level = getUpgradeLevel(state, carId, upgradeId);
  if (level >= def.maxLevel) return Infinity;
  const discount = 1 - globalLevel(state, 'quick-spool') * QUICK_SPOOL_PER_LEVEL;
  return Math.ceil(def.baseCost * Math.pow(def.costGrowth, level) * discount);
}

/** Buy the next level of a part with coins. Returns false if not possible. */
export function buyUpgrade(state: GameState, carId: string, upgradeId: UpgradeKind): boolean {
  if (!state.ownedCars.includes(carId)) return false;
  const cost = getUpgradeCost(state, carId, upgradeId);
  if (!isFinite(cost) || state.currencies.coins < cost) return false;

  state.currencies.coins -= cost;
  const rec = state.upgrades[carId] ?? {};
  rec[upgradeId] = getUpgradeLevel(state, carId, upgradeId) + 1;
  state.upgrades[carId] = rec;
  state.stats.upgradesPurchased += 1;
  return true;
}

// ---------------------------------------------------------------------------
// Global (Horizon shop) upgrades
// ---------------------------------------------------------------------------

/** Token cost of the next level of a Horizon upgrade (Infinity at max/unknown). */
export function getGlobalUpgradeCost(state: GameState, id: string): number {
  const def = getGlobalUpgradeDef(id);
  if (!def) return Infinity;
  const level = globalLevel(state, id);
  if (level >= def.maxLevel) return Infinity;
  return Math.ceil(def.baseCost * Math.pow(def.costGrowth, level));
}

/** Buy the next level of a Horizon upgrade with tokens. */
export function buyGlobalUpgrade(state: GameState, id: string): boolean {
  const cost = getGlobalUpgradeCost(state, id);
  if (!isFinite(cost) || state.currencies.tokens < cost) return false;
  state.currencies.tokens -= cost;
  state.globalUpgrades[id] = globalLevel(state, id) + 1;
  return true;
}

// ---------------------------------------------------------------------------
// Cars
// ---------------------------------------------------------------------------

export function canAffordCar(state: GameState, id: string): boolean {
  const car = CARS.find((c) => c.id === id);
  if (!car) return false;
  if (state.ownedCars.includes(id)) return false;
  return state.currencies[car.costCurrency] >= car.cost;
}

/** Buy a car with its listed currency; creates its upgrade record. */
export function buyCar(state: GameState, id: string): boolean {
  if (!canAffordCar(state, id)) return false;
  const car = getCarDef(id);
  state.currencies[car.costCurrency] -= car.cost;
  state.ownedCars.push(id);
  if (!state.upgrades[id]) state.upgrades[id] = {};
  return true;
}

/** Select an owned car as the current ride. */
export function selectCar(state: GameState, id: string): boolean {
  if (!state.ownedCars.includes(id)) return false;
  state.currentCarId = id;
  if (!state.upgrades[id]) state.upgrades[id] = {};
  return true;
}

// ---------------------------------------------------------------------------
// Prestige
// ---------------------------------------------------------------------------

/** Miles needed before the next prestige is allowed. */
export function getPrestigeMilesRequired(state: GameState): number {
  return PRESTIGE_BASE_MILES * Math.pow(PRESTIGE_MILES_GROWTH, state.stats.prestigeCount);
}

export function getPrestigePreview(state: GameState): PrestigePreview {
  const milesRequired = getPrestigeMilesRequired(state);
  const canPrestige = state.stats.journeyMiles >= milesRequired;
  let tokensOnPrestige = 0;
  if (canPrestige) {
    const tokenMagnet = globalLevel(state, 'token-magnet');
    const base = Math.pow(state.stats.journeyMiles / PRESTIGE_BASE_MILES, PRESTIGE_TOKEN_EXPONENT);
    // The floor is unreachable at today's tuning — `canPrestige` implies
    // journeyMiles >= PRESTIGE_BASE_MILES * PRESTIGE_MILES_GROWTH^count, so
    // `base` is already >= 1 — and it is kept deliberately (issue #25). It is
    // the rule the design wants rather than an arithmetic accident: a prestige
    // the player has *earned* never pays zero tokens. The numbers it depends on
    // live in docs/ECONOMY.md and are meant to be retuned; a growth or exponent
    // change is where this stops being dead.
    tokensOnPrestige = Math.max(1, Math.floor(base * (1 + tokenMagnet * TOKEN_MAGNET_PER_LEVEL)));
  }
  return { tokensOnPrestige, milesRequired, canPrestige };
}

/**
 * Begin a New Journey. Grants tokens; resets journey miles, coins (to the
 * head-start value), and every per-car part level. Cars, relics, tokens,
 * global upgrades, achievements, and lifetime stats are kept.
 * Returns tokens gained (0 if prestige was not allowed).
 */
export function doPrestige(state: GameState): number {
  const preview = getPrestigePreview(state);
  if (!preview.canPrestige) return 0;

  const gained = preview.tokensOnPrestige;
  state.currencies.tokens += gained;
  state.stats.totalTokensEarned += gained;
  state.stats.prestigeCount += 1;

  state.stats.journeyMiles = 0;
  state.stats.journeyActiveMiles = 0;
  state.currencies.coins = headStartCoins(globalLevel(state, 'head-start'));
  for (const carId of Object.keys(state.upgrades)) {
    state.upgrades[carId] = {};
  }
  return gained;
}

// ---------------------------------------------------------------------------
// Pickups / relics / combo helpers
// ---------------------------------------------------------------------------

/**
 * Coin value of a road pickup: roughly PICKUP_VALUE_SECONDS of cruising
 * income, scaled by the current combo — pickups should feel juicy.
 */
export function getPickupCoinValue(state: GameState, combo: number): number {
  const coinsPerSec = (getCarSpeed(state) / 3600) * getCoinRatePerMile(state, NEUTRAL_CTX);
  // Same call as the prestige floor above (issue #25): unreachable today,
  // because `Math.ceil` of a positive is already >= 1, and kept anyway. A coin
  // the player drove over and collected must be worth at least one coin; the
  // clamp is what makes that true if a rate ever rounds to zero.
  return Math.max(1, Math.ceil(coinsPerSec * PICKUP_VALUE_SECONDS * Math.max(1, combo)));
}

/** Chance per mile of a relic spawning in view (chime + keen-eye boosted). */
export function getRelicChancePerMile(state: GameState): number {
  const chime = getUpgradeLevel(state, state.currentCarId, 'chime');
  const keenEye = globalLevel(state, 'keen-eye');
  return (
    BASE_RELIC_CHANCE_PER_MILE *
    (1 + chime * CHIME_RELIC_PER_LEVEL) *
    (1 + keenEye * KEEN_EYE_PER_LEVEL)
  );
}

/** Pickup attraction radius in meters. */
export function getMagnetRadius(state: GameState): number {
  const magnet = getUpgradeLevel(state, state.currentCarId, 'magnet');
  return BASE_MAGNET_RADIUS + magnet * MAGNET_RADIUS_PER_LEVEL;
}

/** Maximum combo multiplier (tires raise it, hard-capped). */
export function getComboCap(state: GameState): number {
  const tires = getUpgradeLevel(state, state.currentCarId, 'tires');
  return Math.min(MAX_COMBO_CAP, BASE_COMBO_CAP + tires * TIRES_CAP_PER_LEVEL);
}

/** Combo points gained per second of continuous styling (drift/near-miss). */
export function getComboGainRate(state: GameState): number {
  const tires = getUpgradeLevel(state, state.currentCarId, 'tires');
  return BASE_COMBO_GAIN + tires * TIRES_GAIN_PER_LEVEL;
}

/** Seconds a combo holds before decaying (momentum extends it). */
export function getComboDuration(state: GameState): number {
  return BASE_COMBO_DURATION + globalLevel(state, 'momentum') * MOMENTUM_SEC_PER_LEVEL;
}
