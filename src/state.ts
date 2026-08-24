import { SAVE_VERSION, type GameState, type GameStats, type RuntimeState } from './types';

export function defaultStats(): GameStats {
  return {
    lifetimeMiles: 0,
    journeyMiles: 0,
    lifetimeCoins: 0,
    pickupsCollected: 0,
    relicsFound: 0,
    driftCount: 0,
    driftMiles: 0,
    nearMisses: 0,
    bestCombo: 1,
    activeMiles: 0,
    idleMiles: 0,
    nightMiles: 0,
    sunsetMiles: 0,
    dawnMiles: 0,
    rainMiles: 0,
    fogMiles: 0,
    leafMiles: 0,
    auroraMiles: 0,
    biomesVisited: ['meadow'],
    weatherSeen: ['clear'],
    upgradesPurchased: 0,
    prestigeCount: 0,
    totalTokensEarned: 0,
    playTimeSec: 0,
    offlineCoinsEarned: 0,
    topSpeed: 0,
    // Seeded 0: main.ts increments once per boot, so the first-ever session
    // counts as 1 and "Welcome Back" (goal 2) waits for a genuine return.
    sessionCount: 0,
  };
}

export function defaultState(): GameState {
  const now = Date.now();
  return {
    version: SAVE_VERSION,
    currencies: { coins: 0, tokens: 0, relics: 0 },
    stats: defaultStats(),
    currentCarId: 'rusty-hatch',
    ownedCars: ['rusty-hatch'],
    upgrades: { 'rusty-hatch': {} },
    globalUpgrades: {},
    achievements: [],
    settings: {
      audioEnabled: true,
      musicVolume: 0.7,
      sfxVolume: 0.8,
      quality: 'high',
      showFps: false,
    },
    lastSaveTime: now,
    createdTime: now,
  };
}

export function defaultRuntime(): RuntimeState {
  return {
    speedMph: 0,
    isActive: false,
    isDrifting: false,
    combo: 1,
    comboTimer: 0,
    biomeId: 'meadow',
    nextBiomeId: 'farmland',
    biomeBlend: 0,
    timeOfDay: 0.38, // start mid-morning
    timePhase: 'day',
    weatherId: 'clear',
    coinRate: 0,
    fps: 60,
    paused: false,
  };
}
