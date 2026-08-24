/**
 * EverRoad — upgrade catalogs.
 *
 * Per-car parts (reset on prestige, bought with coins) and the permanent
 * Horizon shop (bought with tokens). Numeric per-level effects live here as
 * exported constants so economy.ts and the defs can never drift apart.
 */

import type { GlobalUpgradeDef, UpgradeDef, UpgradeKind } from '../../types';

// ---------------------------------------------------------------------------
// Per-car part effect constants (per level)
// ---------------------------------------------------------------------------

/** Engine: +mph per level. */
export const ENGINE_MPH_PER_LEVEL = 2;
/** Tuning: +8% coin multiplier per level (additive on the car's coinMult). */
export const TUNING_MULT_PER_LEVEL = 0.08;
/** Tires: +combo cap per level. */
export const TIRES_CAP_PER_LEVEL = 0.5;
/** Tires: +combo gain rate per level (combo points/sec while styling). */
export const TIRES_GAIN_PER_LEVEL = 0.03;
/** Magnet: +pickup attraction radius (meters) per level. */
export const MAGNET_RADIUS_PER_LEVEL = 0.7;
/** Chime: +15% relic spot chance per level. */
export const CHIME_RELIC_PER_LEVEL = 0.15;

export const UPGRADES: UpgradeDef[] = [
  {
    id: 'engine',
    name: 'Engine',
    description: 'Bigger pistons, happier hum. Cruise faster and cover more miles.',
    maxLevel: 25,
    baseCost: 15,
    costGrowth: 1.55,
    effectLabel: `+${ENGINE_MPH_PER_LEVEL} mph`,
  },
  {
    id: 'tuning',
    name: 'Tuning',
    description: 'Carburetor whispering. Every mile pays a little more.',
    maxLevel: 25,
    baseCost: 20,
    costGrowth: 1.6,
    effectLabel: `+${Math.round(TUNING_MULT_PER_LEVEL * 100)}% coins`,
  },
  {
    id: 'tires',
    name: 'Tires',
    description: 'Grippier rubber for longer, wilder drifts. Raises the combo cap.',
    maxLevel: 15,
    baseCost: 40,
    costGrowth: 1.65,
    effectLabel: `+${TIRES_CAP_PER_LEVEL} combo cap`,
  },
  {
    id: 'magnet',
    name: 'Magnet',
    description: 'A gently humming coil that tugs coins toward your fenders.',
    maxLevel: 10,
    baseCost: 60,
    costGrowth: 1.7,
    effectLabel: `+${MAGNET_RADIUS_PER_LEVEL} m radius`,
  },
  {
    id: 'chime',
    name: 'Chime',
    description: 'A little bell that rings near hidden relics. Sharpens your eye.',
    maxLevel: 10,
    baseCost: 80,
    costGrowth: 1.75,
    effectLabel: `+${Math.round(CHIME_RELIC_PER_LEVEL * 100)}% relic chance`,
  },
];

/** Convenience lookup for a per-car part definition. */
export function getUpgradeDef(id: UpgradeKind): UpgradeDef {
  return UPGRADES.find((u) => u.id === id) ?? UPGRADES[0]!;
}

// ---------------------------------------------------------------------------
// Horizon shop (global, permanent) effect constants (per level)
// ---------------------------------------------------------------------------

/** horizon-flow: +10% global coin multiplier per level. */
export const HORIZON_FLOW_PER_LEVEL = 0.1;
/** long-haul: offline earnings start at 40% of live idle rate... */
export const LONG_HAUL_BASE = 0.4;
/** ...and gain +8% per level (level 10 = 120%). */
export const LONG_HAUL_PER_LEVEL = 0.08;
/** momentum: +1 s combo duration per level. */
export const MOMENTUM_SEC_PER_LEVEL = 1;
/** head-start: coins granted after each prestige, per level (level * this * 2^(level-1)). */
export const HEAD_START_BASE_COINS = 250;
/** token-magnet: +10% prestige token gain per level. */
export const TOKEN_MAGNET_PER_LEVEL = 0.1;
/** keen-eye: +15% relic spot chance per level. */
export const KEEN_EYE_PER_LEVEL = 0.15;
/** overdrive: +5% top speed per level. */
export const OVERDRIVE_PER_LEVEL = 0.05;
/** quick-spool: -2% per-car upgrade cost per level. */
export const QUICK_SPOOL_PER_LEVEL = 0.02;

/** Coins granted right after a prestige for a given head-start level. */
export function headStartCoins(level: number): number {
  if (level <= 0) return 0;
  return Math.floor(HEAD_START_BASE_COINS * level * Math.pow(2, level - 1));
}

export const GLOBAL_UPGRADES: GlobalUpgradeDef[] = [
  {
    id: 'horizon-flow',
    name: 'Horizon Flow',
    description: 'The road remembers you. All coin earnings increased, forever.',
    maxLevel: 50,
    baseCost: 1,
    costGrowth: 1.6,
    effectLabel: `+${Math.round(HORIZON_FLOW_PER_LEVEL * 100)}% coins`,
  },
  {
    id: 'long-haul',
    name: 'Long Haul',
    description: 'Your car keeps cruising while you are away. Raises the offline earning rate.',
    maxLevel: 10,
    baseCost: 2,
    costGrowth: 1.6,
    effectLabel: `+${Math.round(LONG_HAUL_PER_LEVEL * 100)}% offline rate`,
  },
  {
    id: 'momentum',
    name: 'Momentum',
    description: 'Style lingers like dust in golden light. Combos last longer.',
    maxLevel: 10,
    baseCost: 2,
    costGrowth: 1.6,
    effectLabel: `+${MOMENTUM_SEC_PER_LEVEL} s combo`,
  },
  {
    id: 'head-start',
    name: 'Head Start',
    description: 'Every new journey begins with a packed glovebox of coins.',
    maxLevel: 8,
    baseCost: 1,
    costGrowth: 1.7,
    effectLabel: 'more starting coins',
  },
  {
    id: 'token-magnet',
    name: 'Token Magnet',
    description: 'The horizon pays better. Earn more tokens from each prestige.',
    maxLevel: 20,
    baseCost: 3,
    costGrowth: 1.6,
    effectLabel: `+${Math.round(TOKEN_MAGNET_PER_LEVEL * 100)}% tokens`,
  },
  {
    id: 'keen-eye',
    name: 'Keen Eye',
    description: 'You start noticing the glint in the reeds. More relics found.',
    maxLevel: 15,
    baseCost: 2,
    costGrowth: 1.6,
    effectLabel: `+${Math.round(KEEN_EYE_PER_LEVEL * 100)}% relic chance`,
  },
  {
    id: 'overdrive',
    name: 'Overdrive',
    description: 'A permanent lightness in every engine. All cars cruise faster.',
    maxLevel: 20,
    baseCost: 3,
    costGrowth: 1.65,
    effectLabel: `+${Math.round(OVERDRIVE_PER_LEVEL * 100)}% top speed`,
  },
  {
    id: 'quick-spool',
    name: 'Quick Spool',
    description: 'Parts practically install themselves. Car upgrades cost less.',
    maxLevel: 15,
    baseCost: 2,
    costGrowth: 1.6,
    effectLabel: `-${Math.round(QUICK_SPOOL_PER_LEVEL * 100)}% upgrade cost`,
  },
];

/** Convenience lookup for a Horizon shop definition. */
export function getGlobalUpgradeDef(id: string): GlobalUpgradeDef | undefined {
  return GLOBAL_UPGRADES.find((u) => u.id === id);
}
