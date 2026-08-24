import { describe, it, expect, beforeEach } from 'vitest';
import { defaultState, defaultRuntime } from '../../state';
import { checkAchievements, getProgress } from './tracker';
import { ACHIEVEMENTS } from './definitions';
import { applyTick, doPrestige } from '../economy/economy';
import type { AchievementCategory, EconomyContext, GameState, RuntimeState } from '../../types';
import {
  SLOW_DRIVE_MIN_MPH,
  SLOW_DRIVE_REQUIRED_SEC,
  getSlowDriveSeconds,
  resetSlowDrive,
  updateSlowDrive,
} from './slowDrive';

function ids(defs: ReturnType<typeof checkAchievements>): string[] {
  return defs.map((d) => d.id);
}

/**
 * Run the tracker to a fixed point. A single pass can leave work behind: a coin
 * bounty granted by a late-category def raises lifetimeCoins after the wealth
 * ladder has already been evaluated, so the next pass picks it up. Tests that
 * care about one specific unlock settle first.
 */
function settle(state: GameState, runtime: RuntimeState = defaultRuntime()): void {
  for (let i = 0; i < 20; i++) {
    if (checkAchievements(state, runtime).length === 0) return;
  }
  throw new Error('achievement cascade did not settle');
}

function defById(id: string) {
  const def = ACHIEVEMENTS.find((d) => d.id === id);
  if (!def) throw new Error(`no achievement "${id}"`);
  return def;
}

beforeEach(() => {
  resetSlowDrive();
});

// ---------------------------------------------------------------------------
// Definitions table — structural sweep
// ---------------------------------------------------------------------------

describe('ACHIEVEMENTS table', () => {
  it('matches the documented total and per-category counts', () => {
    // ARCHITECTURE.md §9 / docs/ACHIEVEMENTS.md.
    expect(ACHIEVEMENTS).toHaveLength(127);
    const counts: Partial<Record<AchievementCategory, number>> = {};
    for (const def of ACHIEVEMENTS) counts[def.category] = (counts[def.category] ?? 0) + 1;
    expect(counts).toEqual({
      distance: 20,
      wealth: 16,
      garage: 17,
      skill: 21,
      explorer: 23,
      dedication: 12,
      prestige: 8,
      secret: 10,
    });
  });

  it('has unique ids', () => {
    const seen = new Map<string, number>();
    for (const def of ACHIEVEMENTS) seen.set(def.id, (seen.get(def.id) ?? 0) + 1);
    const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id);
    expect(dupes).toEqual([]);
    expect(seen.size).toBe(ACHIEVEMENTS.length);
  });

  it('has unique names', () => {
    const names = ACHIEVEMENTS.map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('gives every entry a non-empty id, name, description, icon and condition', () => {
    for (const def of ACHIEVEMENTS) {
      expect(def.id, 'id').toMatch(/^[a-z0-9-]+$/);
      expect(def.name.trim(), `${def.id} name`).not.toBe('');
      expect(def.description.trim(), `${def.id} description`).not.toBe('');
      expect(def.icon.trim(), `${def.id} icon`).not.toBe('');
      expect(typeof def.condition, `${def.id} condition`).toBe('function');
    }
  });

  it('only ever grants positive, finite coin or token bounties', () => {
    for (const def of ACHIEVEMENTS) {
      if (!def.reward) continue;
      for (const [currency, amount] of Object.entries(def.reward)) {
        expect(Number.isFinite(amount), `${def.id} ${currency}`).toBe(true);
        expect(amount, `${def.id} ${currency}`).toBeGreaterThan(0);
      }
      // No definition awards relics today; the tracker's relic branch is
      // reachable only if one is added, and this pins that assumption.
      expect(def.reward.relics).toBeUndefined();
    }
  });

  it('marks secrets only inside the secret category', () => {
    for (const def of ACHIEVEMENTS) {
      if (def.secret) expect(def.category, def.id).toBe('secret');
    }
  });
});

// ---------------------------------------------------------------------------
// Definitions table — no auto-unlock, total conditions
// ---------------------------------------------------------------------------

/**
 * The two achievements that are true by construction on a brand-new save:
 * defaultStats() seeds biomesVisited: ['meadow'] and weatherSeen: ['clear']
 * because the player genuinely starts in Meadowlight under a clear sky. Every
 * other achievement must stay locked at boot — an entry escaping this list is
 * the "condition already satisfied on a fresh state" bug class.
 */
const STARTING_CONDITION_UNLOCKS = ['emerald-welcome', 'blue-skies'];

describe('no achievement auto-unlocks on a fresh save', () => {
  it('leaves everything but the two starting-condition freebies locked', () => {
    const state = defaultState();
    state.stats.sessionCount += 1; // what main.ts does at boot
    const unlocked = ids(checkAchievements(state, defaultRuntime()));
    expect(unlocked.sort()).toEqual([...STARTING_CONDITION_UNLOCKS].sort());
  });

  it('reports every def whose condition is already true on defaultState()', () => {
    // Same guard at the definition level, so it holds even if the tracker changes.
    const state = defaultState();
    const runtime = defaultRuntime();
    const satisfied = ACHIEVEMENTS.filter((d) => d.condition(state, runtime)).map((d) => d.id);
    expect(satisfied.sort()).toEqual([...STARTING_CONDITION_UNLOCKS].sort());
  });

  it('grants at most the two freebie bounties in the first pass', () => {
    const state = defaultState();
    checkAchievements(state, defaultRuntime());
    const expected = STARTING_CONDITION_UNLOCKS.reduce(
      (sum, id) => sum + (defById(id).reward?.coins ?? 0),
      0,
    );
    expect(state.currencies.coins).toBe(expected);
    expect(state.currencies.tokens).toBe(0);
    expect(state.currencies.relics).toBe(0);
  });
});

describe('every achievement condition is total', () => {
  /** Everything maxed: the far end of a very long save. */
  function extremeState(): GameState {
    const state = defaultState();
    state.currencies = { coins: 1e18, tokens: 1e6, relics: 1e4 };
    state.ownedCars = [
      'rusty-hatch',
      'commuter',
      'homestead-wagon',
      'orchard-pickup',
      'wanderer-van',
      'sunday-classic',
      'ember-gt',
      'crimson-comet',
      'petal-roadster',
      'horizon-s',
      'marsh-wraith',
      'auroracraft',
    ];
    state.currentCarId = 'auroracraft';
    for (const carId of state.ownedCars) {
      state.upgrades[carId] = { engine: 25, tuning: 25, tires: 15, magnet: 10, chime: 10 };
    }
    state.globalUpgrades = {
      'horizon-flow': 50,
      'long-haul': 10,
      momentum: 10,
      'head-start': 8,
      'token-magnet': 20,
      'keen-eye': 15,
      overdrive: 20,
      'quick-spool': 15,
    };
    const stats = state.stats as unknown as Record<string, unknown>;
    for (const key of Object.keys(stats)) {
      if (!Array.isArray(stats[key])) stats[key] = 1e12;
    }
    state.stats.biomesVisited = [
      'meadow',
      'farmland',
      'sunflower',
      'pine',
      'autumn',
      'lavender',
      'cherry',
      'wetland',
    ];
    state.stats.weatherSeen = ['clear', 'rain', 'fog', 'leaves', 'aurora'];
    return state;
  }

  /** Nothing at all: an emptied-out (but structurally legal) save. */
  function emptyState(): GameState {
    const state = defaultState();
    state.ownedCars = [];
    state.upgrades = {};
    state.globalUpgrades = {};
    state.stats.biomesVisited = [];
    state.stats.weatherSeen = [];
    state.stats.bestCombo = 0;
    return state;
  }

  function extremeRuntime(): RuntimeState {
    return {
      ...defaultRuntime(),
      speedMph: 1e6,
      isActive: true,
      isDrifting: true,
      combo: 1e6,
      comboTimer: 1e6,
      biomeId: 'wetland',
      nextBiomeId: 'cherry',
      biomeBlend: 1,
      timeOfDay: 0.999,
      timePhase: 'night',
      weatherId: 'aurora',
      coinRate: 1e9,
      fps: 240,
      paused: false,
    };
  }

  it.each([
    ['a default state', () => defaultState(), () => defaultRuntime()],
    ['an emptied state', emptyState, () => defaultRuntime()],
    ['an extreme state', extremeState, extremeRuntime],
  ])('returns a boolean without throwing for %s', (_label, makeState, makeRuntime) => {
    const state = makeState();
    const runtime = makeRuntime();
    for (const def of ACHIEVEMENTS) {
      let result: unknown;
      expect(() => {
        result = def.condition(state, runtime);
      }, `${def.id} threw`).not.toThrow();
      expect(typeof result, `${def.id} returned a non-boolean`).toBe('boolean');
    }
  });

  it('leaves the state untouched — conditions are pure', () => {
    const state = defaultState();
    const runtime = defaultRuntime();
    const before = structuredClone(state);
    for (const def of ACHIEVEMENTS) def.condition(state, runtime);
    expect(state).toEqual(before);
  });

  it('unlocks the whole wall against a maxed-out state', () => {
    // A condition that can never fire is the standing risk in this subsystem
    // (ARCHITECTURE.md §9), so every non-runtime-gated def must be reachable.
    const state = extremeState();
    updateSlowDrive(SLOW_DRIVE_REQUIRED_SEC, 10, false);
    // journeyActiveMiles is 1e12 above, which is exactly what Ghost Driver
    // forbids; give it the hands-off journey it asks for instead.
    state.stats.journeyActiveMiles = 0;
    const runtime = extremeRuntime();
    settle(state, runtime);
    const missing = ACHIEVEMENTS.map((d) => d.id).filter((id) => !state.achievements.includes(id));
    // Only the mutually-exclusive scene secrets can be out of reach in a single
    // runtime snapshot, and exactly these five: extremeRuntime() is a drifting
    // night run through the aurora over the Dawnmarsh, so rain, sunset/autumn,
    // cherry/leaves, dawn and pine/fog are the scenes it cannot also be. Any
    // other id appearing here is a condition that can never fire — pin the set
    // rather than the category, so a secret cannot quietly become unreachable.
    expect(missing).toEqual([
      'midnight-downpour',
      'ember-dance',
      'petal-waltz',
      'dawn-patrol',
      'into-the-mist',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Secret scene conditions — the pause guard
// ---------------------------------------------------------------------------

/**
 * Every scene-sampled secret is gated on `!runtime.paused`. A paused game keeps
 * its last biome/weather/phase snapshot, and combo/drift state freezes with it,
 * so without the guard the pause overlay would hand out bounties for a scene
 * nobody is driving through. One row per distinct guard shape.
 */
const SCENE_SECRETS: {
  id: string;
  /** Extra state the condition needs beyond a fresh save. */
  state?: (state: GameState) => void;
  /** The runtime snapshot that satisfies the scene. */
  runtime: Partial<RuntimeState>;
}[] = [
  { id: 'midnight-downpour', runtime: { timePhase: 'night', weatherId: 'rain', speedMph: 60 } },
  { id: 'marsh-lights', runtime: { weatherId: 'aurora', biomeId: 'wetland' } },
  {
    id: 'ember-dance',
    runtime: { isDrifting: true, biomeId: 'autumn', timePhase: 'sunset', combo: 8 },
  },
  { id: 'petal-waltz', runtime: { isDrifting: true, biomeId: 'cherry', weatherId: 'leaves' } },
  { id: 'dawn-patrol', runtime: { biomeId: 'wetland', timePhase: 'dawn', speedMph: 45 } },
  { id: 'into-the-mist', runtime: { biomeId: 'pine', weatherId: 'fog', timePhase: 'night' } },
  {
    id: 'chasing-the-lights',
    state: (state) => {
      state.ownedCars.push('auroracraft');
      state.currentCarId = 'auroracraft';
    },
    runtime: { weatherId: 'aurora' },
  },
];

describe('secret scene conditions', () => {
  function scene(entry: (typeof SCENE_SECRETS)[number], paused: boolean) {
    const state = defaultState();
    entry.state?.(state);
    const runtime: RuntimeState = { ...defaultRuntime(), ...entry.runtime, paused };
    return { state, runtime };
  }

  it('covers every def carrying a pause guard', () => {
    // If a new scene secret is added, it belongs in the table below.
    const guarded = ACHIEVEMENTS.filter(
      (d) => d.category === 'secret' && !d.condition(defaultState(), defaultRuntime()),
    )
      .map((d) => d.id)
      .filter((id) => SCENE_SECRETS.some((e) => e.id === id));
    expect(guarded).toEqual(SCENE_SECRETS.map((e) => e.id));
  });

  it.each(SCENE_SECRETS)('$id unlocks while driving the scene', (entry) => {
    const { state, runtime } = scene(entry, false);
    expect(defById(entry.id).condition(state, runtime)).toBe(true);
    expect(ids(checkAchievements(state, runtime))).toContain(entry.id);
  });

  it.each(SCENE_SECRETS)('$id stays locked while the same scene is paused', (entry) => {
    const { state, runtime } = scene(entry, true);
    expect(defById(entry.id).condition(state, runtime)).toBe(false);
    expect(ids(checkAchievements(state, runtime))).not.toContain(entry.id);
    expect(state.achievements).not.toContain(entry.id);
  });
});

// ---------------------------------------------------------------------------
// Tracker behavior
// ---------------------------------------------------------------------------

describe('checkAchievements — unlocking', () => {
  it('returns nothing and grants nothing when no condition is newly met', () => {
    const state = defaultState();
    settle(state);
    const coins = state.currencies.coins;
    const unlocked = checkAchievements(state, defaultRuntime());
    expect(unlocked).toEqual([]);
    expect(state.currencies.coins).toBe(coins);
  });

  it('settles the freebie cascade in a bounded number of passes, paying each bounty once', () => {
    // The starting-condition bounties raise lifetimeCoins, which unlocks the
    // first wealth tier on the following pass. That chain must terminate — and
    // the coins it pays must land in both the wallet and lifetimeCoins, which
    // is what makes the chain happen at all.
    const state = defaultState();
    expect(() => settle(state)).not.toThrow();
    const expected = state.achievements.reduce(
      (sum, id) => sum + (defById(id).reward?.coins ?? 0),
      0,
    );
    expect(expected).toBeGreaterThan(0);
    expect(state.currencies.coins).toBe(expected);
    expect(state.stats.lifetimeCoins).toBe(expected);
  });

  it('pushes the id into state.achievements and grants the coin bounty', () => {
    const state = defaultState();
    settle(state);
    const coinsBefore = state.currencies.coins;
    const lifetimeBefore = state.stats.lifetimeCoins;

    state.stats.journeyMiles = 1;
    const unlocked = ids(checkAchievements(state, defaultRuntime()));
    expect(unlocked).toEqual(['first-mile']);
    expect(state.achievements).toContain('first-mile');
    expect(state.currencies.coins).toBe(coinsBefore + 25);
    expect(state.stats.lifetimeCoins).toBe(lifetimeBefore + 25);
  });

  it('never re-unlocks or re-grants an achievement already in the list', () => {
    const state = defaultState();
    state.stats.journeyMiles = 1;
    settle(state);
    const coins = state.currencies.coins;
    const lifetime = state.stats.lifetimeCoins;
    const length = state.achievements.length;

    for (let i = 0; i < 5; i++) checkAchievements(state, defaultRuntime());
    expect(state.currencies.coins).toBe(coins);
    expect(state.stats.lifetimeCoins).toBe(lifetime);
    expect(state.achievements).toHaveLength(length);
    expect(new Set(state.achievements).size).toBe(length);
  });

  it('emits every simultaneous unlock in a single batch', () => {
    const state = defaultState();
    state.stats.journeyMiles = 1000;
    const unlocked = ids(checkAchievements(state, defaultRuntime()));
    // One pass, one array — the UI turns this into one event and a toast stack.
    // The whole journey ladder, the two starting freebies, Ghost Driver (25
    // hands-off miles), and the two wealth tiers the ladder's own bounties pay
    // for in the same pass.
    expect(unlocked).toEqual([
      'first-mile',
      'warming-up',
      'open-road',
      'horizon-bound',
      'long-hauler',
      'century-drive',
      'pocket-change',
      'coin-collector',
      'emerald-welcome',
      'blue-skies',
      'ghost-driver',
    ]);
  });

  it('preserves definition order within a batch so ladders read bottom-up', () => {
    const state = defaultState();
    state.stats.journeyMiles = 1000;
    const unlocked = ids(checkAchievements(state, defaultRuntime()));
    const order = ACHIEVEMENTS.map((d) => d.id);
    const positions = unlocked.map((id) => order.indexOf(id));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('respects ids already present in a loaded save', () => {
    const state = defaultState();
    state.achievements = ['first-mile', 'emerald-welcome', 'blue-skies'];
    state.stats.journeyMiles = 1;
    const unlocked = ids(checkAchievements(state, defaultRuntime()));
    expect(unlocked).toEqual([]);
    expect(state.currencies.coins).toBe(0);
  });

  it('does not re-grant a bounty for an id restored from a save', () => {
    // The dedupe that matters most: a reloaded save must not pay out again.
    const earned = defaultState();
    settle(earned);
    const paid = earned.currencies.coins;

    const reloaded = defaultState();
    reloaded.achievements = [...earned.achievements];
    reloaded.currencies.coins = paid;
    reloaded.stats.lifetimeCoins = earned.stats.lifetimeCoins;
    settle(reloaded);
    expect(reloaded.currencies.coins).toBe(paid);
    expect(reloaded.achievements).toEqual(earned.achievements);
  });

  it('resyncs when the achievements array is swapped out by a save import', () => {
    const state = defaultState();
    state.stats.journeyMiles = 1;
    settle(state);
    const coins = state.currencies.coins;

    // A fresh array with the same contents (what importSave hands back).
    state.achievements = [...state.achievements];
    expect(ids(checkAchievements(state, defaultRuntime()))).toEqual([]);
    expect(state.currencies.coins).toBe(coins);

    // A different array that has forgotten first-mile: it re-unlocks, which is
    // the correct read of "this save has not earned it".
    state.achievements = state.achievements.filter((id) => id !== 'first-mile');
    expect(ids(checkAchievements(state, defaultRuntime()))).toEqual(['first-mile']);
  });

  it('keeps two states independent of each other', () => {
    const a = defaultState();
    const b = defaultState();
    a.stats.journeyMiles = 1;
    checkAchievements(a, defaultRuntime());
    expect(a.achievements).toContain('first-mile');
    // b has driven nothing, so it earns the two starting freebies and nothing
    // else — asserting the exact batch means a leak from a's cache is visible
    // here, and so is a tracker that has stopped unlocking anything at all.
    expect(ids(checkAchievements(b, defaultRuntime()))).toEqual(STARTING_CONDITION_UNLOCKS);
  });
});

describe('checkAchievements — session count', () => {
  it('keeps "Welcome Back" locked on a fresh install (sessionCount 1 after the boot increment)', () => {
    const state = defaultState();
    state.stats.sessionCount += 1; // what main.ts does at boot
    expect(state.stats.sessionCount).toBe(1);
    const unlocked = ids(checkAchievements(state, defaultRuntime()));
    expect(unlocked).toEqual(STARTING_CONDITION_UNLOCKS);
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

describe('getProgress', () => {
  it('reports zero of the full wall on a fresh save', () => {
    expect(getProgress(defaultState())).toEqual({ unlocked: 0, total: ACHIEVEMENTS.length });
  });

  it('counts unlocked ids', () => {
    const state = defaultState();
    state.achievements = ['first-mile', 'open-road'];
    expect(getProgress(state).unlocked).toBe(2);
  });

  it('ignores stale ids from an older build so progress cannot exceed the total', () => {
    const state = defaultState();
    state.achievements = ['first-mile', 'removed-in-v2', 'also-gone'];
    const progress = getProgress(state);
    expect(progress.unlocked).toBe(1);
    expect(progress.unlocked).toBeLessThanOrEqual(progress.total);
  });

  it('reaches the total when every id is present', () => {
    const state = defaultState();
    state.achievements = ACHIEVEMENTS.map((d) => d.id);
    expect(getProgress(state)).toEqual({
      unlocked: ACHIEVEMENTS.length,
      total: ACHIEVEMENTS.length,
    });
  });
});

// ---------------------------------------------------------------------------
// Ghost Driver — per-journey hands-off condition
// ---------------------------------------------------------------------------

describe('Ghost Driver', () => {
  const GHOST = defById('ghost-driver');

  function ctx(overrides: Partial<EconomyContext> = {}): EconomyContext {
    return {
      dtSec: 1,
      milesDelta: 1,
      isActive: false,
      combo: 1,
      biomeId: 'meadow',
      timePhase: 'day',
      weatherId: 'clear',
      ...overrides,
    };
  }

  /** Drive `miles` one mile at a time, hands-on or hands-off. */
  function drive(state: GameState, miles: number, isActive: boolean): void {
    for (let i = 0; i < miles; i++) applyTick(state, ctx({ isActive }));
  }

  it('stays locked before the 25-mile mark', () => {
    const state = defaultState();
    drive(state, 24, false);
    expect(GHOST.condition(state, defaultRuntime())).toBe(false);
    expect(ids(checkAchievements(state, defaultRuntime()))).not.toContain('ghost-driver');
  });

  it('unlocks after 25 hands-off miles', () => {
    const state = defaultState();
    drive(state, 25, false);
    expect(GHOST.condition(state, defaultRuntime())).toBe(true);
    expect(ids(checkAchievements(state, defaultRuntime()))).toContain('ghost-driver');
  });

  it('stays locked forever once the player steers, however far they then coast', () => {
    const state = defaultState();
    drive(state, 1, true); // one hands-on mile spoils the journey
    drive(state, 100, false);
    expect(state.stats.journeyActiveMiles).toBe(1);
    expect(GHOST.condition(state, defaultRuntime())).toBe(false);
    expect(ids(checkAchievements(state, defaultRuntime()))).not.toContain('ghost-driver');
  });

  it('is spoiled by even a fractional hands-on mile', () => {
    const state = defaultState();
    applyTick(state, ctx({ isActive: true, milesDelta: 0.001 }));
    drive(state, 30, false);
    expect(GHOST.condition(state, defaultRuntime())).toBe(false);
  });

  it('becomes earnable again after a prestige resets the journey', () => {
    const state = defaultState();
    drive(state, 30, true); // a hands-on journey, well past the gate
    expect(GHOST.condition(state, defaultRuntime())).toBe(false);

    expect(doPrestige(state)).toBeGreaterThan(0);
    expect(state.stats.journeyActiveMiles).toBe(0);
    expect(state.stats.journeyMiles).toBe(0);
    expect(GHOST.condition(state, defaultRuntime())).toBe(false); // no miles yet

    drive(state, 25, false);
    expect(GHOST.condition(state, defaultRuntime())).toBe(true);
    expect(ids(checkAchievements(state, defaultRuntime()))).toContain('ghost-driver');
  });

  it('does not count lifetime active miles against a fresh journey', () => {
    const state = defaultState();
    state.stats.activeMiles = 10_000; // a veteran's lifetime total
    drive(state, 25, false);
    expect(state.stats.journeyActiveMiles).toBe(0);
    expect(GHOST.condition(state, defaultRuntime())).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Slow drive (Sunday Stroll)
// ---------------------------------------------------------------------------

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
    // The band opens strictly above SLOW_DRIVE_MIN_MPH — exactly 3 mph is still
    // rolling away from a stop, not ambling.
    updateSlowDrive(5, SLOW_DRIVE_MIN_MPH, false);
    expect(getSlowDriveSeconds()).toBe(0);
  });

  it('ignores speeds at or above the upper edge of the band', () => {
    updateSlowDrive(5, 20, false);
    expect(getSlowDriveSeconds()).toBe(0);
    updateSlowDrive(5, 21, false);
    expect(getSlowDriveSeconds()).toBe(0);
  });

  it('treats a negative dt as no progress rather than winding the run back', () => {
    updateSlowDrive(6, 10, false);
    updateSlowDrive(-100, 10, false);
    expect(getSlowDriveSeconds()).toBe(6);
  });

  it('accumulates across many frame-sized steps', () => {
    for (let i = 0; i < 600; i++) updateSlowDrive(1 / 60, 10, false);
    expect(getSlowDriveSeconds()).toBeCloseTo(10, 6);
  });
});
