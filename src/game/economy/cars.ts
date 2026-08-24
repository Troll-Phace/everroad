/**
 * Everroad — car catalog.
 *
 * Twelve cars across seven tiers, from the free rusty-hatch to the
 * token-bought Auroracraft. Costs roughly x6–10 per coin tier; relic and
 * token cars sit beside their coin-tier peers as "collector" alternatives.
 */

import type { CarDef } from '../../types';

export const STARTER_CAR_ID = 'rusty-hatch';

export const CARS: CarDef[] = [
  {
    id: 'rusty-hatch',
    name: 'Rusty Hatchback',
    description: 'It rattles, it wheezes, it never stops. Your faithful first ride.',
    cost: 0,
    costCurrency: 'coins',
    baseSpeed: 42,
    coinMult: 1.0,
    tier: 0,
    style: {
      bodyType: 'compact',
      bodyColor: '#d98e73',
      accentColor: '#8a5a44',
      scale: 0.9,
    },
  },
  {
    id: 'commuter',
    name: 'Commuter',
    description: 'Sensible, dependable, and finally free of the morning traffic.',
    cost: 400,
    costCurrency: 'coins',
    baseSpeed: 52,
    coinMult: 1.25,
    tier: 1,
    style: {
      bodyType: 'sedan',
      bodyColor: '#7fb4d9',
      accentColor: '#e8eef2',
      scale: 1.0,
    },
  },
  {
    id: 'homestead-wagon',
    name: 'Homestead Wagon',
    description: 'Wood-paneled and warm-hearted. Smells faintly of picnics.',
    cost: 700,
    costCurrency: 'coins',
    baseSpeed: 55,
    coinMult: 1.45,
    tier: 1,
    style: {
      bodyType: 'wagon',
      bodyColor: '#a8c98a',
      accentColor: '#b58a5f',
      scale: 1.05,
    },
  },
  {
    id: 'orchard-pickup',
    name: 'Orchard Pickup',
    description: 'Still carries the scent of apples from a hundred harvests.',
    cost: 3500,
    costCurrency: 'coins',
    baseSpeed: 62,
    coinMult: 1.9,
    tier: 2,
    style: {
      bodyType: 'pickup',
      bodyColor: '#e0a458',
      accentColor: '#7a4f2e',
      scale: 1.1,
    },
  },
  {
    id: 'wanderer-van',
    name: 'Wanderer Van',
    description: 'Home is wherever the road bends next.',
    cost: 6000,
    costCurrency: 'coins',
    baseSpeed: 66,
    coinMult: 2.2,
    tier: 2,
    style: {
      bodyType: 'van',
      bodyColor: '#8fd0c4',
      accentColor: '#f2e3b5',
      scale: 1.15,
    },
  },
  {
    id: 'sunday-classic',
    name: 'Sunday Classic',
    description: 'Chrome polished every weekend for forty years, and it shows.',
    cost: 28000,
    costCurrency: 'coins',
    baseSpeed: 74,
    coinMult: 3.0,
    tier: 3,
    style: {
      bodyType: 'classic',
      bodyColor: '#dfe6ec',
      accentColor: '#a9302a',
      scale: 1.05,
    },
  },
  {
    id: 'ember-gt',
    name: 'Ember GT',
    description: 'Rumbles like distant thunder rolling over Emberwood.',
    cost: 45000,
    costCurrency: 'coins',
    baseSpeed: 80,
    coinMult: 3.5,
    tier: 3,
    style: {
      bodyType: 'muscle',
      bodyColor: '#e2673f',
      accentColor: '#2f2a28',
      scale: 1.1,
    },
  },
  {
    id: 'crimson-comet',
    name: 'Crimson Comet',
    description: 'A red streak the sunset itself slows down to watch.',
    cost: 240000,
    costCurrency: 'coins',
    baseSpeed: 92,
    coinMult: 4.6,
    tier: 4,
    style: {
      bodyType: 'sports',
      bodyColor: '#e0455a',
      accentColor: '#f7f3ea',
      scale: 1.0,
    },
  },
  {
    id: 'petal-roadster',
    name: 'Petal Roadster',
    description: 'Restored with relics from Blossom Vale; petals trail in its wake.',
    cost: 12,
    costCurrency: 'relics',
    baseSpeed: 88,
    coinMult: 5.2,
    tier: 4,
    style: {
      bodyType: 'classic',
      bodyColor: '#f2a9c4',
      accentColor: '#fdf1f5',
      scale: 1.0,
    },
  },
  {
    id: 'horizon-s',
    name: 'Horizon S',
    description: 'Engineered for one purpose: chasing the vanishing point.',
    cost: 1800000,
    costCurrency: 'coins',
    baseSpeed: 112,
    coinMult: 7.0,
    tier: 5,
    style: {
      bodyType: 'super',
      bodyColor: '#9a7fd9',
      accentColor: '#3a2f52',
      scale: 1.0,
    },
  },
  {
    id: 'marsh-wraith',
    name: 'Marsh Wraith',
    description: 'Glides out of the Dawnmarsh mist. Locals swear it drives itself.',
    cost: 30,
    costCurrency: 'relics',
    baseSpeed: 105,
    coinMult: 8.0,
    tier: 5,
    style: {
      bodyType: 'sports',
      bodyColor: '#7c9bb8',
      accentColor: '#cfe6da',
      scale: 1.0,
    },
  },
  {
    id: 'auroracraft',
    name: 'Auroracraft',
    description: 'Woven from token-light and night sky. The road no longer applies.',
    cost: 200,
    costCurrency: 'tokens',
    baseSpeed: 150,
    coinMult: 12.0,
    tier: 6,
    style: {
      bodyType: 'hover',
      bodyColor: '#8fe0d4',
      accentColor: '#c9a9f2',
      scale: 1.1,
    },
  },
];

/** Look up a car definition; unknown ids fall back to the starter car. */
export function getCarDef(id: string): CarDef {
  const def = CARS.find((c) => c.id === id);
  if (def) return def;
  // CARS[0] is always the starter; the non-null assertion is safe by construction.
  return CARS.find((c) => c.id === STARTER_CAR_ID) ?? CARS[0]!;
}
