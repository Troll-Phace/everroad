import { SAVE_VERSION, type GameState } from '../types';
import { defaultState, defaultStats } from '../state';

const KEY = 'everroad-save-v1';
const EXPORT_PREFIX = 'EVR1.';
/** Offline progress is honored up to 14 days. */
export const MAX_OFFLINE_SEC = 14 * 24 * 3600;

export function saveGame(state: GameState): void {
  try {
    state.lastSaveTime = Date.now();
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (err) {
    console.warn('[save] failed to save', err);
  }
}

/** Load and migrate a save, deep-merged over defaults so new fields appear. */
export function loadGame(): GameState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return hydrate(parsed as Partial<GameState>);
  } catch (err) {
    console.warn('[save] failed to load, starting fresh', err);
    return null;
  }
}

export function clearSave(): void {
  localStorage.removeItem(KEY);
}

export function exportSave(state: GameState): string {
  const bytes = new TextEncoder().encode(JSON.stringify(state));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return EXPORT_PREFIX + btoa(bin);
}

export function importSave(code: string): GameState | null {
  try {
    const trimmed = code.trim();
    if (!trimmed.startsWith(EXPORT_PREFIX)) return null;
    const bin = atob(trimmed.slice(EXPORT_PREFIX.length));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const json = new TextDecoder().decode(bytes);
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object' || !('currencies' in parsed)) return null;
    return hydrate(parsed as Partial<GameState>);
  } catch {
    return null;
  }
}

/** Seconds the player has been away, clamped to the offline cap. */
export function offlineSeconds(state: GameState, nowMs = Date.now()): number {
  const gap = (nowMs - state.lastSaveTime) / 1000;
  return Math.min(Math.max(0, gap), MAX_OFFLINE_SEC);
}

/** Merge a (possibly older) save over fresh defaults + run migrations. */
function hydrate(loaded: Partial<GameState>): GameState {
  const base = defaultState();
  const state: GameState = {
    ...base,
    ...loaded,
    currencies: { ...base.currencies, ...loaded.currencies },
    stats: { ...defaultStats(), ...loaded.stats },
    settings: { ...base.settings, ...loaded.settings },
    upgrades: loaded.upgrades ?? base.upgrades,
    globalUpgrades: loaded.globalUpgrades ?? base.globalUpgrades,
    // Deduped: repeated ids in a crafted import would otherwise re-grant
    // bounties whenever the array is rebuilt around them.
    achievements: Array.isArray(loaded.achievements) ? [...new Set(loaded.achievements)] : [],
    ownedCars: loaded.ownedCars?.length ? loaded.ownedCars : base.ownedCars,
  };
  if (!state.ownedCars.includes(state.currentCarId)) {
    state.currentCarId = state.ownedCars[0];
  }
  // Future migrations key off state.version here.
  state.version = SAVE_VERSION;
  return state;
}
