import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  MAX_OFFLINE_SEC,
  clearSave,
  exportSave,
  hasSave,
  importSave,
  loadGame,
  offlineSeconds,
  saveGame,
} from './save';
import { defaultState, defaultStats } from '../state';
import { initEconomy, getPrestigePreview } from '../game/economy/economy';
import { SAVE_VERSION, type GameState } from '../types';
import { ACHIEVEMENTS } from '../game/achievements/definitions';

/**
 * The storage contract from ARCHITECTURE.md §12/§15. Asserted on the literal
 * keys deliberately: renaming either one silently orphans a player's progress,
 * so the names are part of the observable behavior, not an implementation
 * detail.
 */
const KEY = 'everroad-save-v1';
const FUTURE_KEY = 'everroad-save-v1-future';

/** Encode raw JSON text the same way exportSave does (EVR1. + base64). */
function encode(json: string): string {
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return `EVR1.${btoa(bin)}`;
}

/** Serialize a state, then rewrite it as raw JSON text so a test can craft
 *  fields TypeScript would never let it assign. */
function craft(mutate: (raw: Record<string, unknown>) => void): string {
  const raw = JSON.parse(JSON.stringify(defaultState())) as Record<string, unknown>;
  mutate(raw);
  return JSON.stringify(raw);
}

// ---------------------------------------------------------------------------
// localStorage double
// ---------------------------------------------------------------------------

interface FakeStorage {
  map: Map<string, string>;
  /** When set, setItem throws this for any key (quota exhausted / private mode). */
  throwOnSet: Error | null;
  /** When set, getItem throws this (storage access denied). */
  throwOnGet: Error | null;
  setCalls: string[];
}

let store: FakeStorage;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  store = { map: new Map(), throwOnSet: null, throwOnGet: null, setCalls: [] };
  const impl = {
    getItem(key: string): string | null {
      if (store.throwOnGet) throw store.throwOnGet;
      return store.map.has(key) ? store.map.get(key)! : null;
    },
    setItem(key: string, value: string): void {
      store.setCalls.push(key);
      if (store.throwOnSet) throw store.throwOnSet;
      store.map.set(key, value);
    },
    removeItem(key: string): void {
      store.map.delete(key);
    },
    clear(): void {
      store.map.clear();
    },
  };
  vi.stubGlobal('localStorage', impl);
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  warn.mockRestore();
});

// ---------------------------------------------------------------------------
// Round-trip fidelity
// ---------------------------------------------------------------------------

/** A state with every field moved off its default, to catch a field the
 *  export/hydrate pair silently drops. */
function populatedState(): GameState {
  const state = defaultState();
  state.currencies = { coins: 12_345.5, tokens: 42, relics: 7 };
  state.currentCarId = 'ember-gt';
  state.ownedCars = ['rusty-hatch', 'commuter', 'ember-gt'];
  state.upgrades = {
    'rusty-hatch': { engine: 4, tuning: 2 },
    'ember-gt': { engine: 11, tires: 3, magnet: 1, chime: 2 },
  };
  state.globalUpgrades = { 'horizon-flow': 6, 'long-haul': 3, overdrive: 2 };
  state.achievements = ['first-mile', 'open-road', 'welcome-back'];
  state.settings = {
    audioEnabled: false,
    musicVolume: 0.31,
    sfxVolume: 0.22,
    quality: 'low',
    showFps: true,
  };
  state.stats = {
    ...defaultStats(),
    lifetimeMiles: 9876.25,
    journeyMiles: 120.5,
    lifetimeCoins: 500_000,
    pickupsCollected: 311,
    relicsFound: 4,
    driftCount: 88,
    driftMiles: 12.75,
    nearMisses: 140,
    bestCombo: 6.5,
    activeMiles: 400.5,
    journeyActiveMiles: 30.25,
    idleMiles: 9475.75,
    nightMiles: 1000,
    sunsetMiles: 500,
    dawnMiles: 250,
    rainMiles: 300,
    fogMiles: 100,
    leafMiles: 50,
    auroraMiles: 25,
    biomesVisited: ['meadow', 'farmland', 'autumn'],
    weatherSeen: ['clear', 'rain', 'aurora'],
    upgradesPurchased: 37,
    prestigeCount: 3,
    totalTokensEarned: 42,
    playTimeSec: 18_000,
    offlineCoinsEarned: 9000,
    topSpeed: 118.4,
    sessionCount: 12,
  };
  state.lastSaveTime = 1_700_000_000_000;
  state.createdTime = 1_600_000_000_000;
  return state;
}

describe('exportSave / importSave round-trip', () => {
  it('round-trips a legitimate export', () => {
    const state = defaultState();
    state.currencies.coins = 1234;
    state.stats.journeyMiles = 7.5;
    const imported = importSave(exportSave(state));
    expect(imported).not.toBeNull();
    expect(imported!.currencies.coins).toBe(1234);
    expect(imported!.stats.journeyMiles).toBe(7.5);
  });

  it('preserves every field of a fully populated save', () => {
    const state = populatedState();
    const imported = importSave(exportSave(state));
    expect(imported).not.toBeNull();
    expect(imported).toEqual(state);
  });

  it('preserves fractional currencies and stats exactly', () => {
    const state = defaultState();
    state.currencies.coins = 1 / 3;
    state.stats.lifetimeMiles = 0.1 + 0.2;
    const imported = importSave(exportSave(state))!;
    expect(imported.currencies.coins).toBe(1 / 3);
    expect(imported.stats.lifetimeMiles).toBe(0.1 + 0.2);
  });

  it('emits the EVR1. prefix over base64 of the state JSON', () => {
    const state = defaultState();
    const code = exportSave(state);
    expect(code.startsWith('EVR1.')).toBe(true);
    expect(JSON.parse(atob(code.slice('EVR1.'.length)))).toEqual(JSON.parse(JSON.stringify(state)));
  });

  it('survives multi-byte characters in the payload', () => {
    // TextEncoder/TextDecoder rather than a naive charCode round-trip.
    const json = craft((raw) => {
      raw.achievements = ['première-étape', '🏁', 'ünïcödé'];
    });
    const imported = importSave(encode(json))!;
    expect(imported.achievements).toEqual(['première-étape', '🏁', 'ünïcödé']);
  });

  it('accepts a code with surrounding whitespace or newlines', () => {
    const code = exportSave(defaultState());
    expect(importSave(`   ${code}   `)).not.toBeNull();
    expect(importSave(`\n\t${code}\n`)).not.toBeNull();
  });

  it('accepts a code that a textarea wrapped across lines', () => {
    const code = exportSave(defaultState());
    const wrapped = code.slice(0, 20) + '\n' + code.slice(20, 60) + '\n' + code.slice(60);
    expect(importSave(wrapped)).not.toBeNull();
  });

  it('rejects a lower-cased prefix (the prefix check is case-sensitive)', () => {
    const code = exportSave(defaultState());
    expect(importSave(code.replace('EVR1.', 'evr1.'))).toBeNull();
    expect(importSave(code.replace('EVR1.', 'Evr1.'))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Malformed input
// ---------------------------------------------------------------------------

describe('importSave — malformed input', () => {
  it('rejects garbage and non-EVR1 codes', () => {
    expect(importSave('not a save')).toBeNull();
    expect(importSave('EVR1.%%%%')).toBeNull();
    expect(importSave(encode('"just a string"'))).toBeNull();
  });

  it.each([
    ['empty string', ''],
    ['whitespace only', '   \n  '],
    ['prefix with no payload', 'EVR1.'],
    ['prefix with non-base64 payload', 'EVR1.@@@@'],
    ['base64 of plain text', encode('hello world')],
    ['base64 of a bare number', encode('42')],
    ['base64 of JSON null', encode('null')],
    ['base64 of JSON true', encode('true')],
    ['base64 of an array', encode('[1,2,3]')],
    ['an object without currencies', encode('{"version":1,"stats":{}}')],
    ['truncated JSON', encode('{"currencies":{"coins":1')],
  ])('returns null for %s', (_label, code) => {
    expect(importSave(code)).toBeNull();
  });

  it('returns null for a code truncated mid-base64', () => {
    const code = exportSave(defaultState());
    expect(importSave(code.slice(0, code.length - 30))).toBeNull();
  });

  it('returns null rather than throwing on null/undefined/non-string input', () => {
    expect(importSave(null as unknown as string)).toBeNull();
    expect(importSave(undefined as unknown as string)).toBeNull();
    expect(importSave(123 as unknown as string)).toBeNull();
    expect(importSave({} as unknown as string)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Hostile / adversarial values
// ---------------------------------------------------------------------------

describe('importSave — hostile values', () => {
  it('defuses a crafted 1e309 journeyMiles exploit once initEconomy runs', () => {
    const base = defaultState();
    const json = JSON.stringify(base).replace('"journeyMiles":0', '"journeyMiles":1e309');
    const imported = importSave(encode(json));
    expect(imported).not.toBeNull();
    // JSON.parse turns 1e309 into Infinity; the load path always runs
    // initEconomy next, which must neutralize it.
    initEconomy(imported!);
    expect(imported!.stats.journeyMiles).toBe(0);
    for (const [key, value] of Object.entries(imported!.stats)) {
      if (Array.isArray(value)) continue;
      expect(Number.isFinite(value), `stats.${key} should be finite`).toBe(true);
      expect(value as number, `stats.${key} should be non-negative`).toBeGreaterThanOrEqual(0);
    }
    const preview = getPrestigePreview(imported!);
    expect(preview.canPrestige).toBe(false);
    expect(Number.isFinite(preview.tokensOnPrestige)).toBe(true);
  });

  it('zeroes every non-finite and negative currency', () => {
    const json = craft((raw) => {
      raw.currencies = { coins: 1e309, tokens: -500, relics: -1e309 };
    });
    const imported = importSave(encode(json))!;
    initEconomy(imported);
    expect(imported.currencies).toEqual({ coins: 0, tokens: 0, relics: 0 });
  });

  it('zeroes a currency of the wrong type', () => {
    const json = craft((raw) => {
      raw.currencies = { coins: '999999', tokens: null, relics: { hax: 1 } };
    });
    const imported = importSave(encode(json))!;
    initEconomy(imported);
    expect(imported.currencies).toEqual({ coins: 0, tokens: 0, relics: 0 });
  });

  it('keeps a huge-but-finite balance rather than discarding it', () => {
    // 1e300 is finite and non-negative: sanitization is about poison, not caps.
    const json = craft((raw) => {
      (raw.currencies as Record<string, unknown>).coins = 1e300;
    });
    const imported = importSave(encode(json))!;
    initEconomy(imported);
    expect(imported.currencies.coins).toBe(1e300);
    expect(Number.isFinite(imported.currencies.coins)).toBe(true);
  });

  it('zeroes every non-finite and negative stat', () => {
    const json = craft((raw) => {
      raw.stats = {
        ...defaultStats(),
        lifetimeMiles: -1,
        journeyMiles: 1e309,
        topSpeed: '600',
        prestigeCount: -1e309,
        sessionCount: null,
      };
    });
    const imported = importSave(encode(json))!;
    initEconomy(imported);
    expect(imported.stats.lifetimeMiles).toBe(0);
    expect(imported.stats.journeyMiles).toBe(0);
    expect(imported.stats.topSpeed).toBe(0);
    expect(imported.stats.prestigeCount).toBe(0);
    expect(imported.stats.sessionCount).toBe(0);
  });

  it('restores the visited/seen arrays when they are not arrays', () => {
    const json = craft((raw) => {
      const stats = raw.stats as Record<string, unknown>;
      stats.biomesVisited = 'meadow';
      stats.weatherSeen = null;
    });
    const imported = importSave(encode(json))!;
    initEconomy(imported);
    expect(imported.stats.biomesVisited).toEqual(['meadow']);
    expect(imported.stats.weatherSeen).toEqual(['clear']);
  });

  it('fills missing stats from defaults instead of leaking undefined', () => {
    const imported = importSave(encode('{"currencies":{"coins":10}}'))!;
    expect(imported.stats).toEqual(defaultStats());
    expect(imported.currencies).toEqual({ coins: 10, tokens: 0, relics: 0 });
    expect(imported.settings).toEqual(defaultState().settings);
    expect(imported.ownedCars).toEqual(['rusty-hatch']);
    expect(imported.currentCarId).toBe('rusty-hatch');
    for (const value of Object.values(imported.stats)) {
      expect(value).toBeDefined();
    }
  });

  it('drops unknown cars, forces the starter, and repairs the current car', () => {
    const json = craft((raw) => {
      raw.ownedCars = ['not-a-car', 'ember-gt'];
      raw.currentCarId = 'ferrari';
    });
    const imported = importSave(encode(json))!;
    initEconomy(imported);
    expect(imported.ownedCars).toEqual(['rusty-hatch', 'ember-gt']);
    expect(imported.currentCarId).toBe('rusty-hatch');
  });

  it('repairs an ownedCars field that is not an array', () => {
    const json = craft((raw) => {
      raw.ownedCars = 'rusty-hatch';
    });
    const imported = importSave(encode(json))!;
    initEconomy(imported);
    expect(Array.isArray(imported.ownedCars)).toBe(true);
    expect(imported.ownedCars).toEqual(['rusty-hatch']);
  });

  it('clamps per-car part levels above their max', () => {
    const json = craft((raw) => {
      raw.ownedCars = ['rusty-hatch'];
      raw.upgrades = { 'rusty-hatch': { engine: 9999, tuning: -5, tires: 7.9 } };
    });
    const imported = importSave(encode(json))!;
    initEconomy(imported);
    expect(imported.upgrades['rusty-hatch'].engine).toBe(25);
    expect(imported.upgrades['rusty-hatch'].tuning).toBe(0);
    expect(imported.upgrades['rusty-hatch'].tires).toBe(7); // floored, not rounded
  });

  it('drops a non-finite or non-numeric part level to zero, not to the cap', () => {
    const json = craft((raw) => {
      raw.ownedCars = ['rusty-hatch'];
      raw.upgrades = { 'rusty-hatch': { engine: 1e309, tuning: 'max', magnet: null } };
    });
    const imported = importSave(encode(json))!;
    initEconomy(imported);
    expect(imported.upgrades['rusty-hatch'].engine).toBe(0);
    expect(imported.upgrades['rusty-hatch'].tuning).toBe(0);
    expect(imported.upgrades['rusty-hatch'].magnet).toBe(0);
  });

  it('clamps global upgrade levels and drops unknown ids', () => {
    const json = craft((raw) => {
      raw.globalUpgrades = { 'horizon-flow': 9999, 'long-haul': -3, 'free-money': 100 };
    });
    const imported = importSave(encode(json))!;
    initEconomy(imported);
    expect(imported.globalUpgrades['horizon-flow']).toBe(50);
    expect(imported.globalUpgrades['long-haul']).toBe(0);
    expect(imported.globalUpgrades['free-money']).toBeUndefined();
  });

  it('repairs upgrades / globalUpgrades fields that are not objects', () => {
    const json = craft((raw) => {
      raw.upgrades = 5;
      raw.globalUpgrades = null;
    });
    const imported = importSave(encode(json))!;
    initEconomy(imported);
    expect(imported.upgrades['rusty-hatch']).toEqual({});
    expect(imported.globalUpgrades).toEqual({});
  });

  it('dedupes repeated achievement ids in an imported save', () => {
    const base = defaultState();
    base.achievements = ['first-mile', 'first-mile', 'open-road', 'first-mile'];
    const imported = importSave(exportSave(base));
    expect(imported!.achievements).toEqual(['first-mile', 'open-road']);
  });

  it('replaces a non-array achievements field with an empty list', () => {
    const base = defaultState();
    const json = JSON.stringify(base).replace('"achievements":[]', '"achievements":"hacked"');
    const imported = importSave(encode(json));
    expect(imported!.achievements).toEqual([]);
  });

  it('never lets a __proto__ payload reach Object.prototype', () => {
    const json =
      '{"currencies":{"coins":1},"__proto__":{"polluted":"yes"},' +
      '"upgrades":{"__proto__":{"polluted":"yes"}},' +
      '"globalUpgrades":{"__proto__":{"polluted":"yes"}},' +
      '"stats":{"__proto__":{"polluted":"yes"}}}';
    const imported = importSave(encode(json));
    expect(imported).not.toBeNull();
    initEconomy(imported!);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect((Object.prototype as unknown as Record<string, unknown>).polluted).toBeUndefined();
    expect(([] as unknown as Record<string, unknown>).polluted).toBeUndefined();
    // And the imported save is still a usable one.
    expect(imported!.currencies.coins).toBe(1);
    expect(Object.getPrototypeOf(imported!.upgrades)).toBe(Object.prototype);
  });

  it('ignores unknown extra fields without corrupting known ones', () => {
    const json = craft((raw) => {
      raw.cheatMode = true;
      raw.futureFeature = { nested: [1, 2, 3] };
      (raw.currencies as Record<string, unknown>).dogecoin = 99;
    });
    const imported = importSave(encode(json))!;
    initEconomy(imported);
    expect(imported.currencies.coins).toBe(0);
    expect(imported.stats).toEqual(defaultStats());
    expect(imported.version).toBe(SAVE_VERSION);
  });
});

// ---------------------------------------------------------------------------
// Forward-version guard
// ---------------------------------------------------------------------------

describe('forward-version guard — importSave', () => {
  it('refuses an import written by a newer build', () => {
    const state = defaultState();
    state.version = SAVE_VERSION + 1;
    expect(importSave(exportSave(state))).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it('refuses a far-future version too', () => {
    const json = craft((raw) => {
      raw.version = 999;
    });
    expect(importSave(encode(json))).toBeNull();
  });

  it('accepts the current version and stamps it', () => {
    const imported = importSave(exportSave(defaultState()))!;
    expect(imported.version).toBe(SAVE_VERSION);
  });

  it('accepts an older version and migrates it up to SAVE_VERSION', () => {
    const json = craft((raw) => {
      raw.version = 0;
    });
    const imported = importSave(encode(json))!;
    expect(imported.version).toBe(SAVE_VERSION);
  });

  it('treats a non-numeric version as not-future and repairs it', () => {
    // isFutureSave only fires on a numeric version; a string version is a
    // corrupt save, not a newer one, and hydrate stamps it back to current.
    const json = craft((raw) => {
      raw.version = '999';
    });
    const imported = importSave(encode(json));
    expect(imported).not.toBeNull();
    expect(imported!.version).toBe(SAVE_VERSION);
  });
});

describe('forward-version guard — loadGame', () => {
  function storeFuture(): string {
    const state = defaultState();
    state.version = SAVE_VERSION + 1;
    state.currencies.coins = 777;
    const raw = JSON.stringify(state);
    store.map.set(KEY, raw);
    return raw;
  }

  it('refuses a newer-build save and starts fresh', () => {
    storeFuture();
    expect(loadGame()).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it('copies the newer-build save aside byte-for-byte before starting fresh', () => {
    const raw = storeFuture();
    loadGame();
    expect(store.map.get(FUTURE_KEY)).toBe(raw);
    // The original is left in place; the fresh-start autosave is what overwrites it.
    expect(store.map.get(KEY)).toBe(raw);
  });

  it('still refuses (and does not throw) when the backup write fails', () => {
    storeFuture();
    store.throwOnSet = new Error('QuotaExceededError');
    expect(() => loadGame()).not.toThrow();
    expect(loadGame()).toBeNull();
    expect(store.map.has(FUTURE_KEY)).toBe(false);
    expect(warn).toHaveBeenCalled();
  });

  it('keeps the newer-build backup across a clearSave', () => {
    // clearSave is "reset my progress", not "throw away the save this build
    // could not read" — the backup must survive so the newer build can recover.
    storeFuture();
    loadGame();
    saveGame(defaultState());
    clearSave();
    expect(store.map.has(KEY)).toBe(false);
    expect(store.map.has(FUTURE_KEY)).toBe(true);
  });

  it('accepts an equal or older stored version', () => {
    const state = defaultState();
    state.version = SAVE_VERSION;
    state.currencies.coins = 500;
    store.map.set(KEY, JSON.stringify(state));
    expect(loadGame()!.currencies.coins).toBe(500);

    store.map.set(KEY, JSON.stringify({ ...state, version: 0, currencies: { coins: 5 } }));
    const older = loadGame()!;
    expect(older.version).toBe(SAVE_VERSION);
    expect(older.currencies.coins).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// localStorage behavior
// ---------------------------------------------------------------------------

describe('saveGame / loadGame', () => {
  it('round-trips a populated state through localStorage', () => {
    const state = populatedState();
    saveGame(state);
    const loaded = loadGame()!;
    // saveGame stamps lastSaveTime on the state it is handed, so the in-memory
    // state already carries the value that was written.
    expect(loaded).toEqual(state);
  });

  it('stamps lastSaveTime with the current clock', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01T12:00:00Z'));
    const state = defaultState();
    saveGame(state);
    expect(state.lastSaveTime).toBe(Date.now());
    expect(JSON.parse(store.map.get(KEY)!).lastSaveTime).toBe(Date.now());
  });

  it('swallows a quota error instead of throwing into the frame loop', () => {
    store.throwOnSet = new Error('QuotaExceededError');
    expect(() => saveGame(defaultState())).not.toThrow();
    expect(warn).toHaveBeenCalled();
    expect(store.map.has(KEY)).toBe(false);
  });

  it('returns null when no save is stored', () => {
    expect(loadGame()).toBeNull();
  });

  it.each([
    ['an empty string', ''],
    ['invalid JSON', '{not json'],
    ['JSON null', 'null'],
    ['a bare number', '42'],
    ['a bare string', '"hello"'],
  ])('returns null when the stored value is %s', (_label, raw) => {
    store.map.set(KEY, raw);
    expect(loadGame()).toBeNull();
  });

  it('returns null when localStorage access throws', () => {
    // Safari private mode / storage disabled: degrade to a fresh drive.
    store.throwOnGet = new DOMException('access denied', 'SecurityError');
    expect(loadGame()).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it('clearSave removes the save key only', () => {
    saveGame(defaultState());
    store.map.set('unrelated-key', 'keep me');
    clearSave();
    expect(store.map.has(KEY)).toBe(false);
    expect(store.map.get('unrelated-key')).toBe('keep me');
  });

  it('clearSave on an empty store is a no-op', () => {
    expect(() => clearSave()).not.toThrow();
    expect(store.map.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// journeyActiveMiles migration
// ---------------------------------------------------------------------------

const GHOST_DRIVER = ACHIEVEMENTS.find((d) => d.id === 'ghost-driver')!;

/** A save written before journeyActiveMiles existed. */
function legacyJson(overrides: Record<string, unknown> = {}): string {
  return craft((raw) => {
    const stats = raw.stats as Record<string, unknown>;
    delete stats.journeyActiveMiles;
    stats.activeMiles = 500;
    stats.journeyMiles = 40;
    stats.lifetimeMiles = 4000;
    Object.assign(stats, overrides);
  });
}

describe('journeyActiveMiles migration', () => {
  it('seeds a legacy save from its lifetime activeMiles', () => {
    const imported = importSave(encode(legacyJson()))!;
    expect(imported.stats.journeyActiveMiles).toBe(500);
  });

  it('stops a veteran legacy save from instantly unlocking Ghost Driver', () => {
    const imported = importSave(encode(legacyJson()))!;
    initEconomy(imported);
    expect(imported.stats.journeyMiles).toBeGreaterThanOrEqual(25);
    expect(GHOST_DRIVER.condition(imported, {} as never)).toBe(false);
  });

  it('leaves an explicit journeyActiveMiles alone', () => {
    // A genuine hands-off journey by a veteran keeps its zero.
    const json = craft((raw) => {
      const stats = raw.stats as Record<string, unknown>;
      stats.activeMiles = 500;
      stats.journeyActiveMiles = 0;
      stats.journeyMiles = 40;
    });
    const imported = importSave(encode(json))!;
    expect(imported.stats.journeyActiveMiles).toBe(0);
    expect(GHOST_DRIVER.condition(imported, {} as never)).toBe(true);
  });

  it('leaves a non-zero journeyActiveMiles alone', () => {
    const json = craft((raw) => {
      const stats = raw.stats as Record<string, unknown>;
      stats.activeMiles = 500;
      stats.journeyActiveMiles = 12.5;
    });
    expect(importSave(encode(json))!.stats.journeyActiveMiles).toBe(12.5);
  });

  it('leaves journeyActiveMiles at zero for a save with no stats block at all', () => {
    const imported = importSave(encode('{"currencies":{"coins":1}}'))!;
    expect(imported.stats.journeyActiveMiles).toBe(0);
    expect(imported.stats.activeMiles).toBe(0);
  });

  it('runs on the loadGame path too, not only on import', () => {
    store.map.set(KEY, legacyJson());
    const loaded = loadGame()!;
    expect(loaded.stats.journeyActiveMiles).toBe(500);
    expect(GHOST_DRIVER.condition(loaded, {} as never)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Offline grant
// ---------------------------------------------------------------------------

describe('offlineSeconds', () => {
  function stateAt(lastSaveTime: number): GameState {
    const state = defaultState();
    state.lastSaveTime = lastSaveTime;
    return state;
  }

  it('reports the elapsed gap in seconds', () => {
    expect(offlineSeconds(stateAt(1_000_000), 1_000_000 + 90_000)).toBe(90);
  });

  it('reports zero for no elapsed time', () => {
    expect(offlineSeconds(stateAt(1_000_000), 1_000_000)).toBe(0);
  });

  it('clamps a backwards clock to zero', () => {
    expect(offlineSeconds(stateAt(2_000_000), 1_000_000)).toBe(0);
  });

  it('clamps a gap longer than 14 days to the cap', () => {
    const now = 10_000_000_000;
    const oneYearAgo = now - 365 * 24 * 3600 * 1000;
    expect(offlineSeconds(stateAt(oneYearAgo), now)).toBe(MAX_OFFLINE_SEC);
    expect(MAX_OFFLINE_SEC).toBe(14 * 24 * 3600);
  });

  it('is exact at the cap boundary', () => {
    const now = 10_000_000_000;
    expect(offlineSeconds(stateAt(now - MAX_OFFLINE_SEC * 1000), now)).toBe(MAX_OFFLINE_SEC);
    expect(offlineSeconds(stateAt(now - (MAX_OFFLINE_SEC - 1) * 1000), now)).toBe(
      MAX_OFFLINE_SEC - 1,
    );
  });

  it('defaults nowMs to the current clock', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01T12:00:00Z'));
    const state = stateAt(Date.now() - 120_000);
    expect(offlineSeconds(state)).toBe(120);
  });

  it('grants a full 14 days for a lastSaveTime of 0 rather than something absurd', () => {
    expect(offlineSeconds(stateAt(0), 10_000_000_000)).toBe(MAX_OFFLINE_SEC);
  });

  // Regression: a corrupt lastSaveTime that parses to NaN (e.g.
  // "lastSaveTime":"x" in a hand-edited save) used to propagate straight
  // through the clamp — Math.max(0, NaN) and Math.min(NaN, cap) are both NaN.
  it('clamps a non-numeric lastSaveTime to zero', () => {
    const state = stateAt(0);
    (state as unknown as Record<string, unknown>).lastSaveTime = 'not a time';
    expect(offlineSeconds(state, 10_000_000_000)).toBe(0);
  });

  it('never returns a negative value for any lastSaveTime', () => {
    for (const t of [0, 1, 1_000_000, 10_000_000_000, 1e15]) {
      const sec = offlineSeconds(stateAt(t), 10_000_000_000);
      expect(sec).toBeGreaterThanOrEqual(0);
      expect(sec).toBeLessThanOrEqual(MAX_OFFLINE_SEC);
    }
  });

  // The rule main.ts relies on (docs/ARCHITECTURE.md §4.1): the grant on
  // Continue is measured to the instant the main menu was entered, never to
  // "now", so the title screen can neither eat nor mint offline progress.
  describe('measured to the menu-entry instant', () => {
    const HOUR = 3600_000;

    it('grants nothing for time spent sitting on the main menu after a quit', () => {
      // quitToMenu saves (stamping lastSaveTime) and then enters the menu, so
      // both instants coincide; the player then leaves the title screen up
      // overnight before pressing Continue.
      const quitAt = 1_700_000_000_000;
      const menuEnteredMs = quitAt;
      expect(offlineSeconds(stateAt(quitAt), menuEnteredMs)).toBe(0);
      // Measuring to "now" instead is the bug: eight hours of free coins.
      expect(offlineSeconds(stateAt(quitAt), quitAt + 8 * HOUR)).toBe(8 * 3600);
    });

    it('still grants the real time away at boot', () => {
      const lastPlayed = 1_700_000_000_000;
      const bootedAt = lastPlayed + 8 * HOUR;
      // Twenty minutes of admiring the attract footage adds nothing.
      const continuedAt = bootedAt + 20 * 60_000;
      expect(offlineSeconds(stateAt(lastPlayed), bootedAt)).toBe(8 * 3600);
      expect(offlineSeconds(stateAt(lastPlayed), bootedAt)).toBeLessThan(
        offlineSeconds(stateAt(lastPlayed), continuedAt),
      );
    });
  });
});

// ---------------------------------------------------------------------------
// hasSave — the main menu's "is Continue worth offering" probe (§12)
// ---------------------------------------------------------------------------

describe('hasSave', () => {
  it('is false when nothing is stored', () => {
    expect(hasSave()).toBe(false);
  });

  it('is true for a save this build wrote', () => {
    saveGame(defaultState());
    expect(hasSave()).toBe(true);
  });

  it('is true for an older-version save, which loadGame migrates', () => {
    store.map.set(
      KEY,
      craft((raw) => (raw.version = SAVE_VERSION - 1)),
    );
    expect(hasSave()).toBe(true);
  });

  it('is false for a save from a newer build, which loadGame refuses', () => {
    store.map.set(
      KEY,
      craft((raw) => (raw.version = SAVE_VERSION + 1)),
    );
    expect(hasSave()).toBe(false);
  });

  it('is false for malformed JSON', () => {
    store.map.set(KEY, '{not json');
    expect(hasSave()).toBe(false);
  });

  it.each([['"a string"'], ['42'], ['null'], ['""']])('is false for non-object JSON %s', (raw) => {
    store.map.set(KEY, raw);
    expect(hasSave()).toBe(false);
  });

  it('is false when storage access throws', () => {
    store.throwOnGet = new Error('denied');
    expect(hasSave()).toBe(false);
  });

  it('is false after clearSave', () => {
    saveGame(defaultState());
    clearSave();
    expect(hasSave()).toBe(false);
  });

  /**
   * The whole reason hasSave is separate from loadGame: the menu may poll it
   * freely, so it must never park a future save under the backup key (that
   * would let a later clearSave + fresh autosave look like recovery happened).
   */
  it('writes nothing at all, not even the future-save backup', () => {
    store.map.set(
      KEY,
      craft((raw) => (raw.version = SAVE_VERSION + 5)),
    );
    store.setCalls.length = 0;
    expect(hasSave()).toBe(false);
    expect(store.setCalls).toEqual([]);
    expect(store.map.has(FUTURE_KEY)).toBe(false);
  });
});
