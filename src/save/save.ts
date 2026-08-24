import { SAVE_VERSION, type GameState } from '../types';
import { defaultState, defaultStats } from '../state';

const KEY = 'everroad-save-v1';
/**
 * Where a save written by a newer build is parked when this build refuses it,
 * so the fresh-start autosave that follows cannot overwrite it (see loadGame).
 */
const FUTURE_KEY = 'everroad-save-v1-future';
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

/**
 * True when a parsed save was written by a build newer than this one. Such a
 * save carries fields this version does not know about, and hydrating it would
 * silently drop them and stamp the version down, so it is always refused.
 */
function isFutureSave(parsed: unknown): boolean {
  const version = (parsed as Partial<GameState>).version;
  return typeof version === 'number' && version > SAVE_VERSION;
}

/** Load and migrate a save, deep-merged over defaults so new fields appear. */
export function loadGame(): GameState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (isFutureSave(parsed)) {
      // Fail safe rather than downgrade: the caller starts a fresh state and
      // autosaves over KEY within seconds, so the newer save is copied aside
      // first and can be recovered by running the newer build again.
      console.warn('[save] stored save is from a newer build; starting fresh and backing it up');
      try {
        localStorage.setItem(FUTURE_KEY, raw);
      } catch (err) {
        console.warn('[save] could not back up the newer-build save', err);
      }
      return null;
    }
    return hydrate(parsed as Partial<GameState>);
  } catch (err) {
    console.warn('[save] failed to load, starting fresh', err);
    return null;
  }
}

/**
 * True when localStorage holds a save this build can load — used by the main
 * menu to decide whether Continue is offered (docs/ARCHITECTURE.md §12).
 *
 * Deliberately side-effect free: unlike `loadGame`, it neither hydrates nor
 * parks a refused future-version save under the `-future` backup key. Writing
 * that backup stays `loadGame`'s job, so a menu poll cannot shuffle storage.
 */
export function hasSave(): boolean {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return false;
    return !isFutureSave(parsed);
  } catch {
    return false;
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
    if (isFutureSave(parsed)) {
      console.warn('[save] refused an import from a newer build');
      return null;
    }
    return hydrate(parsed as Partial<GameState>);
  } catch {
    return null;
  }
}

/** Seconds the player has been away, clamped to the offline cap. */
export function offlineSeconds(state: GameState, nowMs = Date.now()): number {
  const gap = (nowMs - state.lastSaveTime) / 1000;
  // A hand-edited non-numeric lastSaveTime makes gap NaN, which both Math.max
  // and Math.min pass straight through — so guard before clamping.
  if (!Number.isFinite(gap)) return 0;
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
  // A save from before journeyActiveMiles existed has no per-journey copy of
  // the active miles; seed it from the lifetime counter so a veteran's save
  // never reads as the hands-off journey it was not.
  if (loaded.stats && loaded.stats.journeyActiveMiles === undefined) {
    state.stats.journeyActiveMiles = state.stats.activeMiles;
  }
  if (!state.ownedCars.includes(state.currentCarId)) {
    state.currentCarId = state.ownedCars[0];
  }
  // Future migrations key off state.version here.
  state.version = SAVE_VERSION;
  return state;
}
