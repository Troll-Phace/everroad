import { SAVE_VERSION, type GameState, type SaveWriteResult } from '../types';
import { defaultState, defaultStats } from '../state';

const KEY = 'everroad-save-v1';
/**
 * Where a save written by a newer build is parked when this build refuses it,
 * so the fresh-start autosave that follows cannot overwrite it. It is not a
 * dead-end: the next boot on a build new enough to read it promotes it back
 * onto the primary key (see `recoverFutureSave` and docs/ARCHITECTURE.md §12).
 */
const FUTURE_KEY = 'everroad-save-v1-future';
const EXPORT_PREFIX = 'EVR1.';
/** Offline progress is honored up to 14 days. */
export const MAX_OFFLINE_SEC = 14 * 24 * 3600;

/**
 * The `lastSaveTime` this tab believes storage holds — stamped on every load
 * and after every successful write. `saveGame` refuses to write when storage
 * has moved past it, which is how a second tab holding a stale snapshot is
 * stopped from clobbering the tab that is actually playing (§12). `null` means
 * this tab has never seen a save in storage.
 */
let knownSaveTime: number | null = null;

/**
 * Latched when this build refused a newer-build save but could not park it
 * under FUTURE_KEY. The refused save is then the only copy in existence, and a
 * session that cannot protect it must not be able to destroy it either, so
 * every `saveGame` becomes a no-op for the rest of the session.
 */
let writesLocked = false;

/**
 * Drop this session's write guards — the freshness baseline and the write
 * lock. A tab never needs this (both guards are meant to live exactly as long
 * as the tab does); it is the seam `save.test.ts` uses to simulate a fresh
 * tab, since a test file shares one module instance across cases.
 */
export function resetSaveGuards(): void {
  knownSaveTime = null;
  writesLocked = false;
}

/** A finite number, or the fallback — a hand-edited save may hold anything. */
function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A parsed save's `lastSaveTime`, or `null` when it does not carry a usable one. */
function timeOf(parsed: Partial<GameState>): number | null {
  const time = parsed.lastSaveTime;
  return typeof time === 'number' && Number.isFinite(time) ? time : null;
}

/** The `lastSaveTime` currently in storage, or `null` if none is readable. */
function storedSaveTime(): number | null {
  const stored = readStored(KEY, false);
  return stored ? timeOf(stored.parsed) : null;
}

/**
 * Write the state to storage, unless a guard forbids it. The result says which:
 * - `ok` — written, and this tab's freshness baseline moved forward with it.
 * - `conflict` — storage holds a save newer than the one this tab knows about,
 *   i.e. another tab has been playing the same save. Refusing is the whole
 *   point: the caller warns the player and offers a reload (§12). Sticky by
 *   construction — this tab's baseline can never catch up again.
 * - `locked` — this session refused a newer-build save it could not back up.
 * - `error` — storage threw (quota exhausted / private mode).
 *
 * `lastSaveTime` is only stamped on a write that actually happens, so a
 * refused save leaves the caller's offline accounting untouched.
 */
export function saveGame(state: GameState): SaveWriteResult {
  if (writesLocked) {
    console.warn('[save] saving is disabled for this session; refusing to write');
    return 'locked';
  }
  const stored = storedSaveTime();
  if (stored !== null && (knownSaveTime === null || stored > knownSaveTime)) {
    console.warn('[save] storage holds a newer save (another tab?); refusing to overwrite it');
    return 'conflict';
  }
  try {
    const now = Date.now();
    state.lastSaveTime = now;
    localStorage.setItem(KEY, JSON.stringify(state));
    knownSaveTime = now;
    return 'ok';
  } catch (err) {
    console.warn('[save] failed to save', err);
    return 'error';
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

/** A stored save that parsed into an object, alongside its raw text. */
interface StoredSave {
  raw: string;
  parsed: Partial<GameState>;
}

/**
 * Read and parse one storage key. Returns `null` for absent, unparseable, or
 * non-object values. `warn` is on only for the primary key, so a quiet probe
 * of the backup key cannot double up the console noise.
 */
function readStored(key: string, warn: boolean): StoredSave | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return { raw, parsed: parsed as Partial<GameState> };
  } catch (err) {
    if (warn) console.warn('[save] failed to load, starting fresh', err);
    return null;
  }
}

/** A parsed save's `version`, or 0 for one that carries no usable number. */
function versionOf(parsed: Partial<GameState>): number {
  const version = parsed.version;
  return typeof version === 'number' && Number.isFinite(version) ? version : 0;
}

/**
 * Automatic downgrade recovery. A save parked under FUTURE_KEY was refused by
 * an older build for being from the future; the moment a build that
 * understands it runs again, it is loaded back and promoted onto the primary
 * key so the player gets their journey rather than the fresh start the
 * downgrade left behind.
 *
 * Two rules keep the promotion from becoming a delete:
 *
 * - **Only a strictly newer version is recovered.** The parked save must carry
 *   a higher `version` than whatever sits on the primary key, which is exactly
 *   the shape a downgrade leaves: the older build stamps its own lower version
 *   on everything it writes. Comparing save *times* instead would never fire —
 *   the fresh start the older build wrote is always the more recent write —
 *   and the version rule is self-limiting, so the swap below cannot ping-pong
 *   the two keys on every boot.
 * - **The displaced save is swapped into the backup key, never dropped.** The
 *   player who downgraded and then played the older build for a month still
 *   has that month parked under FUTURE_KEY afterwards. It is out of the way,
 *   not gone.
 *
 * Skipped while the primary key itself holds a future-version save: that one
 * is the newest thing in storage and has first claim on the backup slot.
 */
function recoverFutureSave(primary: StoredSave | null): GameState | null {
  if (primary && isFutureSave(primary.parsed)) return null;
  const backup = readStored(FUTURE_KEY, false);
  if (!backup || isFutureSave(backup.parsed)) return null;
  if (primary && versionOf(backup.parsed) <= versionOf(primary.parsed)) return null;
  console.warn('[save] recovering the newer-build save parked under the backup key');
  try {
    localStorage.setItem(KEY, backup.raw);
  } catch (err) {
    // Promotion is a convenience, not the recovery itself: the state is
    // already in hand and the next successful autosave lands it on KEY. The
    // backup stays exactly where it is so the next boot can try again.
    console.warn('[save] could not promote the recovered save', err);
    knownSaveTime = storedSaveTime();
    return hydrate(backup.parsed);
  }
  // A separate write, deliberately: if this one throws, the primary key
  // already holds the recovered save, and the version rule above stops the
  // stale backup from promoting itself over it on the next boot.
  try {
    if (primary) localStorage.setItem(FUTURE_KEY, primary.raw);
    else localStorage.removeItem(FUTURE_KEY);
  } catch (err) {
    console.warn('[save] could not park the save the recovery displaced', err);
  }
  // Read back rather than trusting the promotion: on a failed write KEY still
  // holds the older build's save, and that is the value this tab must treat as
  // its freshness baseline or it would refuse its own next write.
  knownSaveTime = storedSaveTime();
  return hydrate(backup.parsed);
}

/** Load and migrate a save, deep-merged over defaults so new fields appear. */
export function loadGame(): GameState | null {
  const primary = readStored(KEY, true);
  const recovered = recoverFutureSave(primary);
  if (recovered) return recovered;
  if (!primary) return null;
  if (isFutureSave(primary.parsed)) {
    // Fail safe rather than downgrade: the caller starts a fresh state and
    // autosaves over KEY within seconds, so the newer save is copied aside
    // first, to be recovered automatically by the next run of a build that can
    // read it (see recoverFutureSave).
    console.warn('[save] stored save is from a newer build; starting fresh and backing it up');
    try {
      localStorage.setItem(FUTURE_KEY, primary.raw);
    } catch (err) {
      // No backup means the refused save is the only copy left, and the
      // fresh-start autosave would destroy it within seconds. A build that
      // cannot protect the newer save does not get to overwrite it either.
      writesLocked = true;
      console.warn('[save] could not back up the newer-build save; saving is off', err);
      return null;
    }
    knownSaveTime = timeOf(primary.parsed);
    return null;
  }
  knownSaveTime = timeOf(primary.parsed);
  return hydrate(primary.parsed);
}

/**
 * True when localStorage holds a save this build can load — used by the main
 * menu to decide whether Continue is offered (docs/ARCHITECTURE.md §12).
 *
 * Deliberately side-effect free: unlike `loadGame`, it neither hydrates nor
 * parks a refused future-version save under the `-future` backup key, nor
 * promotes a recoverable one out of it. Writing storage stays `loadGame`'s
 * job, so a menu poll cannot shuffle it.
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

/**
 * Erase the player's save — "New Journey" and "Erase EVERYTHING".
 *
 * With one guard: when the primary key holds a save from a newer build, that
 * save is parked under the backup key on the way out. `hasSave()` reads false
 * for a future-version save, so the menu disables Continue *and* skips the
 * New-Journey confirmation — one unconfirmed click would otherwise delete a
 * save this build could not even read. Parking it also protects it, so a
 * session that latched `writesLocked` because the backup write failed earlier
 * is released here.
 *
 * If it cannot be parked, nothing is cleared: storage that refuses writes is
 * not a reason to destroy the only copy of a journey. The session is still
 * write-locked, so the fresh drive that follows was never going to persist
 * anyway, and `persist()` tells the player as much.
 */
export function clearSave(): void {
  const stored = readStored(KEY, false);
  if (stored && isFutureSave(stored.parsed)) {
    try {
      localStorage.setItem(FUTURE_KEY, stored.raw);
      writesLocked = false;
    } catch (err) {
      console.warn('[save] refusing to clear a newer-build save that cannot be backed up', err);
      return;
    }
  }
  localStorage.removeItem(KEY);
  // Nothing is left in storage to be stale against, so the freshness baseline
  // starts over with the next write.
  knownSaveTime = null;
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
  // Built key by key rather than spread over `...loaded`: a hand-edited or
  // imported save may carry arbitrary top-level fields, and hydrate strips
  // them to the known GameState shape (§12) so nothing unknown reaches the
  // live state or gets written back out by the next autosave. The explicit
  // shape also makes the compiler demand a line here for every new field.
  const state: GameState = {
    version: base.version,
    currencies: { ...base.currencies, ...loaded.currencies },
    stats: { ...defaultStats(), ...loaded.stats },
    currentCarId: typeof loaded.currentCarId === 'string' ? loaded.currentCarId : base.currentCarId,
    // Array.isArray, not a truthy `.length`: a string save field has one too,
    // and it would reach the car catalog looking like a list of ids.
    ownedCars:
      Array.isArray(loaded.ownedCars) && loaded.ownedCars.length
        ? loaded.ownedCars
        : base.ownedCars,
    upgrades: loaded.upgrades ?? base.upgrades,
    globalUpgrades: loaded.globalUpgrades ?? base.globalUpgrades,
    // Deduped: repeated ids in a crafted import would otherwise re-grant
    // bounties whenever the array is rebuilt around them.
    achievements: Array.isArray(loaded.achievements) ? [...new Set(loaded.achievements)] : [],
    settings: { ...base.settings, ...loaded.settings },
    // Both clocks are checked, not merely defaulted: a non-numeric one reaches
    // the offline grant and the menu's "last driven" line.
    lastSaveTime: finiteOr(loaded.lastSaveTime, base.lastSaveTime),
    createdTime: finiteOr(loaded.createdTime, base.createdTime),
  };
  // A save from before journeyActiveMiles existed has no per-journey copy of
  // the active miles; seed it from the lifetime counter so a veteran's save
  // never reads as the hands-off journey it was not.
  //
  // Seeding from the *lifetime* counter is deliberate, and it is the
  // conservative direction on purpose. It does deny Ghost Driver to the rare
  // player who had already prestiged and was genuinely mid-hands-off-journey
  // when they upgraded — but that self-corrects at their next prestige, which
  // resets journeyActiveMiles to a real zero. Seeding from zero instead would
  // hand every veteran on the planet the secret achievement and its
  // 5,000-coin bounty the instant they loaded the new build. Do not "fix"
  // this into the exploit (GitHub #24).
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
