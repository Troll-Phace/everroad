/**
 * Everroad — achievement definitions.
 *
 * A RuneScape-style completionist wall: tiered ladders per category plus a
 * handful of quirky secrets. Conditions are pure and cheap — simple numeric
 * comparisons over GameState/RuntimeState, no allocation.
 */

import type {
  AchievementCategory,
  AchievementDef,
  BiomeId,
  CurrencyBalances,
  GameState,
  GameStats,
  WeatherId,
} from '../../types';
import { SLOW_DRIVE_REQUIRED_SEC, getSlowDriveSeconds } from './slowDrive';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Keys of GameStats whose values are numbers (excludes the arrays). */
type NumericStat = {
  [K in keyof GameStats]: GameStats[K] extends number ? K : never;
}[keyof GameStats];

interface TierSpec {
  id: string;
  name: string;
  /** Stat value required to unlock. */
  goal: number;
  description: string;
  /** Overrides the ladder's default icon. */
  icon?: string;
  reward?: Partial<CurrencyBalances>;
}

/** Build a tiered ladder over a single numeric stat. */
function statLadder(
  category: AchievementCategory,
  key: NumericStat,
  defaultIcon: string,
  tiers: TierSpec[],
): AchievementDef[] {
  return tiers.map((t) => {
    const def: AchievementDef = {
      id: t.id,
      name: t.name,
      description: t.description,
      category,
      icon: t.icon ?? defaultIcon,
      condition: (state: GameState) => state.stats[key] >= t.goal,
    };
    if (t.reward) def.reward = t.reward;
    return def;
  });
}

/** "Visit biome X for the first time." */
function biomeFirst(
  biome: BiomeId,
  id: string,
  name: string,
  description: string,
  icon: string,
  reward?: Partial<CurrencyBalances>,
): AchievementDef {
  const def: AchievementDef = {
    id,
    name,
    description,
    category: 'explorer',
    icon,
    condition: (state: GameState) => state.stats.biomesVisited.includes(biome),
  };
  if (reward) def.reward = reward;
  return def;
}

/** "See weather X for the first time." */
function weatherFirst(
  weather: WeatherId,
  id: string,
  name: string,
  description: string,
  icon: string,
  reward?: Partial<CurrencyBalances>,
): AchievementDef {
  const def: AchievementDef = {
    id,
    name,
    description,
    category: 'explorer',
    icon,
    condition: (state: GameState) => state.stats.weatherSeen.includes(weather),
  };
  if (reward) def.reward = reward;
  return def;
}

/** "Own a specific car." */
function ownCar(
  carId: string,
  id: string,
  name: string,
  description: string,
  icon: string,
  reward?: Partial<CurrencyBalances>,
): AchievementDef {
  const def: AchievementDef = {
    id,
    name,
    description,
    category: 'garage',
    icon,
    condition: (state: GameState) => state.ownedCars.includes(carId),
  };
  if (reward) def.reward = reward;
  return def;
}

/** True when any part on any car has reached level `level`. */
function anyPartAtLevel(state: GameState, level: number): boolean {
  const cars = state.upgrades;
  for (const carId in cars) {
    const parts = cars[carId];
    if (!parts) continue;
    for (const kind in parts) {
      const lvl = parts[kind as keyof typeof parts];
      if (lvl !== undefined && lvl >= level) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Distance (20)
// ---------------------------------------------------------------------------

const distance: AchievementDef[] = [
  // Journey miles (reset on prestige) — 6
  ...statLadder('distance', 'journeyMiles', '🛣️', [
    {
      id: 'first-mile',
      name: 'First Mile',
      goal: 1,
      description: 'Drive your first mile of this journey.',
      reward: { coins: 25 },
    },
    {
      id: 'warming-up',
      name: 'Warming Up',
      goal: 5,
      description: 'Drive 5 miles in a single journey.',
      reward: { coins: 75 },
    },
    {
      id: 'open-road',
      name: 'Open Road',
      goal: 10,
      description: 'Drive 10 miles in a single journey.',
      reward: { coins: 200 },
    },
    {
      id: 'horizon-bound',
      name: 'Horizon Bound',
      goal: 25,
      description: 'Drive 25 miles in a single journey — far enough to see a new horizon.',
      reward: { coins: 600 },
    },
    {
      id: 'long-hauler',
      name: 'Long Hauler',
      goal: 50,
      description: 'Drive 50 miles in a single journey.',
      reward: { coins: 2000 },
    },
    {
      id: 'century-drive',
      name: 'Century Drive',
      goal: 100,
      description: 'Drive 100 miles in a single journey.',
      reward: { coins: 6000 },
    },
  ]),
  // Lifetime miles — 11
  ...statLadder('distance', 'lifetimeMiles', '🚗', [
    {
      id: 'country-cruiser',
      name: 'Country Cruiser',
      goal: 10,
      description: 'Drive 10 lifetime miles.',
      reward: { coins: 100 },
    },
    {
      id: 'backroad-regular',
      name: 'Backroad Regular',
      goal: 50,
      description: 'Drive 50 lifetime miles.',
      reward: { coins: 300 },
    },
    {
      id: 'odometer-rising',
      name: 'Odometer Rising',
      goal: 100,
      description: 'Drive 100 lifetime miles.',
      reward: { coins: 750 },
    },
    {
      id: 'cross-country',
      name: 'Cross-Country',
      goal: 500,
      description: 'Drive 500 lifetime miles.',
      reward: { coins: 3000 },
    },
    {
      id: 'thousand-mile-stare',
      name: 'Thousand Mile Stare',
      goal: 1000,
      description: 'Drive 1,000 lifetime miles.',
      reward: { coins: 10_000 },
    },
    {
      id: 'continental-drift',
      name: 'Continental Drift',
      goal: 5000,
      description: 'Drive 5,000 lifetime miles.',
      reward: { coins: 50_000 },
    },
    {
      id: 'coast-to-coast-to-coast',
      name: 'Coast to Coast to Coast',
      goal: 10_000,
      description: 'Drive 10,000 lifetime miles.',
      reward: { coins: 150_000 },
    },
    {
      id: 'around-the-world-twice',
      name: 'Around the World Twice',
      goal: 50_000,
      description: 'Drive 50,000 lifetime miles — twice around the planet.',
      reward: { coins: 1_000_000 },
    },
    {
      id: 'six-figure-odometer',
      name: 'Six-Figure Odometer',
      goal: 100_000,
      description: 'Drive 100,000 lifetime miles.',
      reward: { coins: 5_000_000 },
    },
    {
      id: 'moon-and-back',
      name: 'To the Moon and Back',
      goal: 500_000,
      description: 'Drive 500,000 lifetime miles — a lunar round trip.',
      reward: { coins: 50_000_000 },
    },
    {
      id: 'million-mile-legend',
      name: 'Million Mile Legend',
      goal: 1_000_000,
      description: 'Drive 1,000,000 lifetime miles. The road remembers you.',
      icon: '🌠',
      reward: { coins: 500_000_000, tokens: 10 },
    },
  ]),
  // Idle miles — 3
  ...statLadder('distance', 'idleMiles', '💤', [
    {
      id: 'cruise-control',
      name: 'Cruise Control',
      goal: 10,
      description: 'Let autopilot carry you 10 miles.',
      reward: { coins: 100 },
    },
    {
      id: 'autopilot-aficionado',
      name: 'Autopilot Aficionado',
      goal: 100,
      description: 'Let autopilot carry you 100 miles.',
      reward: { coins: 1000 },
    },
    {
      id: 'the-car-knows-the-way',
      name: 'The Car Knows the Way',
      goal: 1000,
      description: 'Let autopilot carry you 1,000 miles.',
      reward: { coins: 20_000 },
    },
  ]),
];

// ---------------------------------------------------------------------------
// Wealth (16)
// ---------------------------------------------------------------------------

const wealth: AchievementDef[] = [
  // Lifetime coins — 8
  ...statLadder('wealth', 'lifetimeCoins', '🪙', [
    {
      id: 'pocket-change',
      name: 'Pocket Change',
      goal: 100,
      description: 'Earn 100 lifetime coins.',
      reward: { coins: 25 },
    },
    {
      id: 'coin-collector',
      name: 'Coin Collector',
      goal: 1000,
      description: 'Earn 1,000 lifetime coins.',
      reward: { coins: 150 },
    },
    {
      id: 'piggy-bank',
      name: 'Piggy Bank',
      goal: 10_000,
      description: 'Earn 10,000 lifetime coins.',
      reward: { coins: 1500 },
    },
    {
      id: 'small-fortune',
      name: 'Small Fortune',
      goal: 100_000,
      description: 'Earn 100,000 lifetime coins.',
      reward: { coins: 15_000 },
    },
    {
      id: 'millionaires-row',
      name: "Millionaire's Row",
      goal: 1_000_000,
      description: 'Earn 1,000,000 lifetime coins.',
      icon: '💰',
      reward: { coins: 150_000 },
    },
    {
      id: 'deep-pockets',
      name: 'Deep Pockets',
      goal: 10_000_000,
      description: 'Earn 10,000,000 lifetime coins.',
      icon: '💰',
      reward: { coins: 1_500_000 },
    },
    {
      id: 'vault-of-the-valley',
      name: 'Vault of the Valley',
      goal: 100_000_000,
      description: 'Earn 100,000,000 lifetime coins.',
      icon: '🏦',
      reward: { coins: 15_000_000 },
    },
    {
      id: 'billionaire-boulevard',
      name: 'Billionaire Boulevard',
      goal: 1_000_000_000,
      description: 'Earn 1,000,000,000 lifetime coins.',
      icon: '👑',
      reward: { coins: 50_000_000, tokens: 25 },
    },
  ]),
  // Pickups — 3
  ...statLadder('wealth', 'pickupsCollected', '✨', [
    {
      id: 'magpie',
      name: 'Magpie',
      goal: 25,
      description: 'Collect 25 road pickups.',
      reward: { coins: 100 },
    },
    {
      id: 'roadside-bounty',
      name: 'Roadside Bounty',
      goal: 250,
      description: 'Collect 250 road pickups.',
      reward: { coins: 1000 },
    },
    {
      id: 'coin-magnet',
      name: 'Coin Magnet',
      goal: 2500,
      description: 'Collect 2,500 road pickups.',
      reward: { coins: 15_000 },
    },
  ]),
  // Relics — 5
  ...statLadder('wealth', 'relicsFound', '🔮', [
    {
      id: 'first-relic',
      name: 'First Relic',
      goal: 1,
      description: 'Find your first glowing roadside relic.',
      reward: { coins: 250 },
    },
    {
      id: 'curio-collector',
      name: 'Curio Collector',
      goal: 5,
      description: 'Find 5 relics.',
      reward: { coins: 1000 },
    },
    {
      id: 'antiquarian',
      name: 'Antiquarian',
      goal: 15,
      description: 'Find 15 relics.',
      reward: { coins: 5000 },
    },
    {
      id: 'relic-hunter',
      name: 'Relic Hunter',
      goal: 40,
      description: 'Find 40 relics.',
      reward: { coins: 25_000 },
    },
    {
      id: 'museum-on-wheels',
      name: 'Museum on Wheels',
      goal: 100,
      description: 'Find 100 relics — every biome has given up its treasures.',
      icon: '🏛️',
      reward: { coins: 250_000, tokens: 5 },
    },
  ]),
];

// ---------------------------------------------------------------------------
// Garage (17)
// ---------------------------------------------------------------------------

const garage: AchievementDef[] = [
  // Cars owned — 5
  {
    id: 'two-car-household',
    name: 'Two-Car Household',
    description: 'Own 2 cars.',
    category: 'garage',
    icon: '🚙',
    reward: { coins: 200 },
    condition: (state) => state.ownedCars.length >= 2,
  },
  {
    id: 'growing-collection',
    name: 'Growing Collection',
    description: 'Own 4 cars.',
    category: 'garage',
    icon: '🚙',
    reward: { coins: 1000 },
    condition: (state) => state.ownedCars.length >= 4,
  },
  {
    id: 'half-a-dozen',
    name: 'Half a Dozen',
    description: 'Own 6 cars.',
    category: 'garage',
    icon: '🚙',
    reward: { coins: 5000 },
    condition: (state) => state.ownedCars.length >= 6,
  },
  {
    id: 'serious-collector',
    name: 'Serious Collector',
    description: 'Own 9 cars.',
    category: 'garage',
    icon: '🏎️',
    reward: { coins: 50_000 },
    condition: (state) => state.ownedCars.length >= 9,
  },
  {
    id: 'full-garage',
    name: 'Full Garage',
    description: 'Own all 12 cars. Not one empty bay.',
    category: 'garage',
    icon: '🏰',
    reward: { coins: 500_000, tokens: 15 },
    condition: (state) => state.ownedCars.length >= 12,
  },
  // Specific cars — 6
  ownCar(
    'ember-gt',
    'ember-and-ash',
    'Ember & Ash',
    'Buy the Ember GT, forged in Emberwood colors.',
    '🔥',
    { coins: 1000 },
  ),
  ownCar('crimson-comet', 'seeing-red', 'Seeing Red', 'Buy the Crimson Comet.', '☄️', {
    coins: 2500,
  }),
  ownCar(
    'petal-roadster',
    'petal-to-the-metal',
    'Petal to the Metal',
    'Buy the Petal Roadster.',
    '🌸',
    { coins: 5000 },
  ),
  ownCar('horizon-s', 'edge-of-the-horizon', 'Edge of the Horizon', 'Buy the Horizon S.', '🌅', {
    coins: 25_000,
  }),
  ownCar(
    'marsh-wraith',
    'something-in-the-mist',
    'Something in the Mist',
    'Buy the Marsh Wraith.',
    '🧿',
    { coins: 100_000 },
  ),
  ownCar(
    'auroracraft',
    'beyond-the-road',
    'Beyond the Road',
    'Buy the Auroracraft. The wheels were only ever a suggestion.',
    '🛸',
    { coins: 1_000_000, tokens: 20 },
  ),
  // Upgrades purchased — 5
  ...statLadder('garage', 'upgradesPurchased', '🔧', [
    {
      id: 'first-wrench',
      name: 'First Wrench',
      goal: 1,
      description: 'Buy your first part upgrade.',
      reward: { coins: 50 },
    },
    {
      id: 'tinkerer',
      name: 'Tinkerer',
      goal: 10,
      description: 'Buy 10 part upgrades.',
      reward: { coins: 500 },
    },
    {
      id: 'grease-monkey',
      name: 'Grease Monkey',
      goal: 50,
      description: 'Buy 50 part upgrades.',
      reward: { coins: 5000 },
    },
    {
      id: 'master-mechanic',
      name: 'Master Mechanic',
      goal: 150,
      description: 'Buy 150 part upgrades.',
      reward: { coins: 50_000 },
    },
    {
      id: 'assembly-line',
      name: 'Assembly Line',
      goal: 400,
      description: 'Buy 400 part upgrades.',
      icon: '🏭',
      reward: { coins: 500_000 },
    },
  ]),
  // Maxed part — 1
  {
    id: 'perfect-part',
    name: 'Perfect Part',
    description: 'Raise any single part to level 25 — it cannot be improved.',
    category: 'garage',
    icon: '⚙️',
    reward: { coins: 250_000, tokens: 5 },
    condition: (state) => anyPartAtLevel(state, 25),
  },
];

// ---------------------------------------------------------------------------
// Skill (21)
// ---------------------------------------------------------------------------

const skill: AchievementDef[] = [
  // Drift count — 5
  ...statLadder('skill', 'driftCount', '🌀', [
    {
      id: 'first-slide',
      name: 'First Slide',
      goal: 1,
      description: 'Perform your first drift.',
      reward: { coins: 50 },
    },
    {
      id: 'sideways-tendencies',
      name: 'Sideways Tendencies',
      goal: 25,
      description: 'Perform 25 drifts.',
      reward: { coins: 500 },
    },
    {
      id: 'drift-apprentice',
      name: 'Drift Apprentice',
      goal: 100,
      description: 'Perform 100 drifts.',
      reward: { coins: 2500 },
    },
    {
      id: 'smoke-show',
      name: 'Smoke Show',
      goal: 500,
      description: 'Perform 500 drifts.',
      reward: { coins: 15_000 },
    },
    {
      id: 'drift-legend',
      name: 'Drift Legend',
      goal: 2500,
      description: 'Perform 2,500 drifts.',
      icon: '💨',
      reward: { coins: 100_000 },
    },
  ]),
  // Drift miles — 4
  ...statLadder('skill', 'driftMiles', '🛞', [
    {
      id: 'a-mile-sideways',
      name: 'A Mile Sideways',
      goal: 1,
      description: 'Drift for 1 total mile.',
      reward: { coins: 100 },
    },
    {
      id: 'ten-the-hard-way',
      name: 'Ten the Hard Way',
      goal: 10,
      description: 'Drift for 10 total miles.',
      reward: { coins: 1000 },
    },
    {
      id: 'perpetual-slide',
      name: 'Perpetual Slide',
      goal: 100,
      description: 'Drift for 100 total miles.',
      reward: { coins: 15_000 },
    },
    {
      id: 'thousand-mile-drift',
      name: 'Thousand-Mile Drift',
      goal: 1000,
      description: 'Drift for 1,000 total miles. The tires have opinions.',
      reward: { coins: 250_000, tokens: 10 },
    },
  ]),
  // Near misses — 5
  ...statLadder('skill', 'nearMisses', '⚡', [
    {
      id: 'close-call',
      name: 'Close Call',
      goal: 1,
      description: 'Score your first near-miss.',
      reward: { coins: 50 },
    },
    {
      id: 'thread-the-needle',
      name: 'Thread the Needle',
      goal: 50,
      description: 'Score 50 near-misses.',
      reward: { coins: 500 },
    },
    {
      id: 'inches-to-spare',
      name: 'Inches to Spare',
      goal: 250,
      description: 'Score 250 near-misses.',
      reward: { coins: 2500 },
    },
    {
      id: 'daredevil',
      name: 'Daredevil',
      goal: 1000,
      description: 'Score 1,000 near-misses.',
      reward: { coins: 15_000 },
    },
    {
      id: 'untouchable',
      name: 'Untouchable',
      goal: 5000,
      description: 'Score 5,000 near-misses.',
      reward: { coins: 100_000 },
    },
  ]),
  // Best combo — 4
  ...statLadder('skill', 'bestCombo', '🔗', [
    {
      id: 'double-down',
      name: 'Double Down',
      goal: 2,
      description: 'Reach a x2 style combo.',
      reward: { coins: 100 },
    },
    {
      id: 'triple-threat',
      name: 'Triple Threat',
      goal: 3,
      description: 'Reach a x3 style combo.',
      reward: { coins: 500 },
    },
    {
      id: 'high-five',
      name: 'High Five',
      goal: 5,
      description: 'Reach a x5 style combo.',
      reward: { coins: 5000 },
    },
    {
      id: 'style-incarnate',
      name: 'Style Incarnate',
      goal: 8,
      description: 'Reach the x8 style combo cap.',
      icon: '🎯',
      reward: { coins: 50_000 },
    },
  ]),
  // Active miles — 3
  ...statLadder('skill', 'activeMiles', '🎮', [
    {
      id: 'hands-on',
      name: 'Hands On',
      goal: 10,
      description: 'Drive 10 miles with your hands on the wheel.',
      reward: { coins: 250 },
    },
    {
      id: 'wheel-warrior',
      name: 'Wheel Warrior',
      goal: 100,
      description: 'Drive 100 miles with your hands on the wheel.',
      reward: { coins: 2500 },
    },
    {
      id: 'road-virtuoso',
      name: 'Road Virtuoso',
      goal: 1000,
      description: 'Drive 1,000 miles with your hands on the wheel.',
      reward: { coins: 50_000 },
    },
  ]),
];

// ---------------------------------------------------------------------------
// Explorer (23)
// ---------------------------------------------------------------------------

const explorer: AchievementDef[] = [
  // Biomes visited count — 3
  {
    id: 'border-crossing',
    name: 'Border Crossing',
    description: 'Visit 2 different biomes.',
    category: 'explorer',
    icon: '🧭',
    reward: { coins: 250 },
    condition: (state) => state.stats.biomesVisited.length >= 2,
  },
  {
    id: 'sightseer',
    name: 'Sightseer',
    description: 'Visit 4 different biomes.',
    category: 'explorer',
    icon: '🧭',
    reward: { coins: 1000 },
    condition: (state) => state.stats.biomesVisited.length >= 4,
  },
  {
    id: 'world-tour',
    name: 'World Tour',
    description: 'Visit all 8 biomes.',
    category: 'explorer',
    icon: '🌍',
    reward: { coins: 10_000 },
    condition: (state) => state.stats.biomesVisited.length >= 8,
  },
  // Biome firsts — 8
  biomeFirst('meadow', 'emerald-welcome', 'Emerald Welcome', 'Visit the Emerald Meadows.', '🍀', {
    coins: 100,
  }),
  biomeFirst('farmland', 'amber-waves', 'Amber Waves', 'Visit the Amber Farmland.', '🌾', {
    coins: 150,
  }),
  biomeFirst('sunflower', 'golden-coast', 'Golden Coast', 'Visit the Sunflower Coast.', '🌻', {
    coins: 150,
  }),
  biomeFirst(
    'autumn',
    'into-emberwood',
    'Into Emberwood',
    'Cross into Emberwood, where every sunset burns.',
    '🍁',
    { coins: 500 },
  ),
  biomeFirst('pine', 'mistpine-morning', 'Mistpine Morning', 'Visit the Mistpine Hills.', '🌲', {
    coins: 150,
  }),
  biomeFirst('lavender', 'purple-reach', 'Purple Reach', 'Visit the Lavender Reach.', '💜', {
    coins: 150,
  }),
  biomeFirst('cherry', 'blossom-drift', 'Blossom Drift', 'Visit the Blossom Vale.', '🌸', {
    coins: 150,
  }),
  biomeFirst(
    'wetland',
    'dawn-over-the-marsh',
    'Dawn Over the Marsh',
    'Visit the Dawnmarsh.',
    '🪷',
    { coins: 150 },
  ),
  // Weather firsts — 5
  weatherFirst('clear', 'blue-skies', 'Blue Skies', 'Drive under a perfectly clear sky.', '☀️', {
    coins: 100,
  }),
  weatherFirst('rain', 'first-rain', 'First Rain', 'Drive through your first rainfall.', '🌧️', {
    coins: 100,
  }),
  weatherFirst('fog', 'fogbound', 'Fogbound', 'Drive into your first fog bank.', '🌫️', {
    coins: 100,
  }),
  weatherFirst(
    'leaves',
    'falling-leaves',
    'Falling Leaves',
    'Drive through drifting leaves or petals.',
    '🍂',
    { coins: 100 },
  ),
  weatherFirst('aurora', 'skyfire', 'Skyfire', 'Witness the aurora paint the night sky.', '🌌', {
    coins: 1000,
  }),
  // Time-of-day / weather mileage — 7
  ...statLadder('explorer', 'nightMiles', '🌙', [
    {
      id: 'night-owl',
      name: 'Night Owl',
      goal: 10,
      description: 'Drive 10 miles under the stars.',
      reward: { coins: 500 },
    },
    {
      id: 'nocturne',
      name: 'Nocturne',
      goal: 100,
      description: 'Drive 100 miles under the stars.',
      reward: { coins: 5000 },
    },
  ]),
  ...statLadder('explorer', 'sunsetMiles', '🌇', [
    {
      id: 'golden-hour-devotee',
      name: 'Golden Hour Devotee',
      goal: 50,
      description: 'Drive 50 miles through golden-hour sunsets.',
      reward: { coins: 2500 },
    },
  ]),
  ...statLadder('explorer', 'rainMiles', '☔', [
    {
      id: 'rain-dancer',
      name: 'Rain Dancer',
      goal: 10,
      description: 'Drive 10 miles through falling rain.',
      reward: { coins: 500 },
    },
    {
      id: 'storm-chaser',
      name: 'Storm Chaser',
      goal: 100,
      description: 'Drive 100 miles through falling rain.',
      reward: { coins: 5000 },
    },
  ]),
  ...statLadder('explorer', 'fogMiles', '🌁', [
    {
      id: 'fog-runner',
      name: 'Fog Runner',
      goal: 50,
      description: 'Drive 50 miles through thick fog.',
      reward: { coins: 2500 },
    },
  ]),
  ...statLadder('explorer', 'auroraMiles', '✨', [
    {
      id: 'aurora-chaser',
      name: 'Aurora Chaser',
      goal: 10,
      description: 'Drive 10 miles beneath the aurora.',
      reward: { coins: 5000 },
    },
  ]),
];

// ---------------------------------------------------------------------------
// Dedication (12)
// ---------------------------------------------------------------------------

const dedication: AchievementDef[] = [
  // Play time — 5
  ...statLadder('dedication', 'playTimeSec', '⏱️', [
    {
      id: 'just-getting-started',
      name: 'Just Getting Started',
      goal: 600,
      description: 'Play for 10 minutes.',
      reward: { coins: 100 },
    },
    {
      id: 'an-hour-on-the-road',
      name: 'An Hour on the Road',
      goal: 3600,
      description: 'Play for 1 hour.',
      reward: { coins: 1000 },
    },
    {
      id: 'all-afternoon',
      name: 'All Afternoon',
      goal: 21_600,
      description: 'Play for 6 hours.',
      reward: { coins: 10_000 },
    },
    {
      id: 'a-full-day-driving',
      name: 'A Full Day Driving',
      goal: 86_400,
      description: 'Play for 24 hours total.',
      reward: { coins: 50_000 },
    },
    {
      id: 'hundred-hour-club',
      name: 'Hundred Hour Club',
      goal: 360_000,
      description: 'Play for 100 hours total. This road is home now.',
      icon: '🏅',
      reward: { coins: 1_000_000, tokens: 20 },
    },
  ]),
  // Sessions — 3
  ...statLadder('dedication', 'sessionCount', '📅', [
    {
      id: 'welcome-back',
      name: 'Welcome Back',
      goal: 2,
      description: 'Return for a second session.',
      reward: { coins: 250 },
    },
    {
      id: 'frequent-driver',
      name: 'Frequent Driver',
      goal: 7,
      description: 'Play across 7 sessions.',
      reward: { coins: 1000 },
    },
    {
      id: 'regular',
      name: 'Regular',
      goal: 30,
      description: 'Play across 30 sessions. Your seat is always warm.',
      reward: { coins: 10_000 },
    },
  ]),
  // Offline earnings — 4
  ...statLadder('dedication', 'offlineCoinsEarned', '🌜', [
    {
      id: 'while-you-were-away',
      name: 'While You Were Away',
      goal: 1000,
      description: 'Earn 1,000 coins while offline.',
      reward: { coins: 500 },
    },
    {
      id: 'money-in-your-sleep',
      name: 'Money in Your Sleep',
      goal: 100_000,
      description: 'Earn 100,000 coins while offline.',
      reward: { coins: 10_000 },
    },
    {
      id: 'the-road-drives-itself',
      name: 'The Road Drives Itself',
      goal: 10_000_000,
      description: 'Earn 10,000,000 coins while offline.',
      reward: { coins: 500_000 },
    },
    {
      id: 'empire-of-idleness',
      name: 'Empire of Idleness',
      goal: 1_000_000_000,
      description: 'Earn 1,000,000,000 coins while offline.',
      icon: '🌛',
      reward: { coins: 10_000_000, tokens: 15 },
    },
  ]),
];

// ---------------------------------------------------------------------------
// Prestige (8)
// ---------------------------------------------------------------------------

const prestige: AchievementDef[] = [
  // Prestige count — 4
  ...statLadder('prestige', 'prestigeCount', '🌅', [
    {
      id: 'new-journey',
      name: 'New Journey',
      goal: 1,
      description: 'Begin your first New Journey.',
      reward: { coins: 500 },
    },
    {
      id: 'seasoned-traveler',
      name: 'Seasoned Traveler',
      goal: 3,
      description: 'Begin 3 New Journeys.',
      reward: { coins: 2500 },
    },
    {
      id: 'eternal-return',
      name: 'Eternal Return',
      goal: 10,
      description: 'Begin 10 New Journeys.',
      reward: { tokens: 10 },
    },
    {
      id: 'the-long-way-around',
      name: 'The Long Way Around',
      goal: 25,
      description: 'Begin 25 New Journeys. Every ending is a road out.',
      icon: '♾️',
      reward: { tokens: 50 },
    },
  ]),
  // Total tokens earned — 4
  ...statLadder('prestige', 'totalTokensEarned', '🎖️', [
    {
      id: 'first-horizon',
      name: 'First Horizon',
      goal: 1,
      description: 'Earn your first Horizon Token.',
      reward: { coins: 1000 },
    },
    {
      id: 'token-collector',
      name: 'Token Collector',
      goal: 25,
      description: 'Earn 25 Horizon Tokens.',
      reward: { coins: 10_000 },
    },
    {
      id: 'horizon-hoarder',
      name: 'Horizon Hoarder',
      goal: 200,
      description: 'Earn 200 Horizon Tokens.',
      reward: { tokens: 25 },
    },
    {
      id: 'a-thousand-horizons',
      name: 'A Thousand Horizons',
      goal: 1000,
      description: 'Earn 1,000 Horizon Tokens.',
      icon: '🌄',
      reward: { tokens: 100 },
    },
  ]),
];

// ---------------------------------------------------------------------------
// Secret (10)
// ---------------------------------------------------------------------------

const secret: AchievementDef[] = [
  {
    id: 'midnight-downpour',
    name: 'Midnight Downpour',
    description: 'Drive through rain in the dead of night.',
    category: 'secret',
    icon: '🌃',
    secret: true,
    reward: { coins: 1000 },
    condition: (_state, runtime) =>
      !runtime.paused &&
      runtime.timePhase === 'night' &&
      runtime.weatherId === 'rain' &&
      runtime.speedMph > 0,
  },
  {
    id: 'marsh-lights',
    name: 'Marsh Lights',
    description: 'See the aurora reflected in the pools of the Dawnmarsh.',
    category: 'secret',
    icon: '🫧',
    secret: true,
    reward: { coins: 2500 },
    condition: (_state, runtime) =>
      !runtime.paused && runtime.weatherId === 'aurora' && runtime.biomeId === 'wetland',
  },
  {
    id: 'ember-dance',
    name: 'Ember Dance',
    description: 'Hold a maximum combo while drifting through Emberwood at sunset.',
    category: 'secret',
    icon: '🔥',
    secret: true,
    reward: { coins: 25_000, tokens: 25 },
    condition: (_state, runtime) =>
      !runtime.paused &&
      runtime.isDrifting &&
      runtime.biomeId === 'autumn' &&
      runtime.timePhase === 'sunset' &&
      runtime.combo >= 8,
  },
  {
    id: 'sunday-stroll',
    name: 'Sunday Stroll',
    description: 'Amble along at under 20 mph for a while. No hurry at all.',
    category: 'secret',
    icon: '🐢',
    secret: true,
    reward: { coins: 500 },
    // Sustained, not sampled: the frame loop accumulates in-band seconds in
    // slowDrive.ts so the 0-to-cruise ramp of a fresh game cannot trigger it.
    condition: () => getSlowDriveSeconds() >= SLOW_DRIVE_REQUIRED_SEC,
  },
  {
    id: 'redline',
    name: 'Redline',
    description: 'Push past 150 mph.',
    category: 'secret',
    icon: '🚀',
    secret: true,
    reward: { coins: 10_000 },
    condition: (state) => state.stats.topSpeed > 150,
  },
  {
    id: 'ghost-driver',
    name: 'Ghost Driver',
    description: 'Reach 25 journey miles without touching the wheel once.',
    category: 'secret',
    icon: '👻',
    secret: true,
    reward: { coins: 5000 },
    condition: (state) => state.stats.journeyMiles >= 25 && state.stats.journeyActiveMiles === 0,
  },
  {
    id: 'petal-waltz',
    name: 'Petal Waltz',
    description: 'Drift through a storm of petals in the Blossom Vale.',
    category: 'secret',
    icon: '💮',
    secret: true,
    reward: { coins: 2500 },
    condition: (_state, runtime) =>
      !runtime.paused &&
      runtime.isDrifting &&
      runtime.biomeId === 'cherry' &&
      runtime.weatherId === 'leaves',
  },
  {
    id: 'dawn-patrol',
    name: 'Dawn Patrol',
    description: 'Cruise the Dawnmarsh at dawn, when the mist glows gold.',
    category: 'secret',
    icon: '🌄',
    secret: true,
    reward: { coins: 1000 },
    condition: (_state, runtime) =>
      !runtime.paused &&
      runtime.biomeId === 'wetland' &&
      runtime.timePhase === 'dawn' &&
      runtime.speedMph > 0,
  },
  {
    id: 'into-the-mist',
    name: 'Into the Mist',
    description: 'Drive the Mistpine Hills in fog, at night, headlights swallowed whole.',
    category: 'secret',
    icon: '🔦',
    secret: true,
    reward: { coins: 2500 },
    condition: (_state, runtime) =>
      !runtime.paused &&
      runtime.biomeId === 'pine' &&
      runtime.weatherId === 'fog' &&
      runtime.timePhase === 'night',
  },
  {
    id: 'chasing-the-lights',
    name: 'Chasing the Lights',
    description: 'Fly the Auroracraft beneath the aurora it was named for.',
    category: 'secret',
    icon: '🛸',
    secret: true,
    reward: { coins: 100_000, tokens: 25 },
    condition: (state, runtime) =>
      !runtime.paused && state.currentCarId === 'auroracraft' && runtime.weatherId === 'aurora',
  },
];

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const ACHIEVEMENTS: AchievementDef[] = [
  ...distance,
  ...wealth,
  ...garage,
  ...skill,
  ...explorer,
  ...dedication,
  ...prestige,
  ...secret,
];
