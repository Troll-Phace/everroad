/**
 * EverRoad — shared type contracts.
 *
 * This file is the single source of truth for the interfaces between
 * subsystems (engine, economy, achievements, audio, save, ui).
 * All modules import types from here; no module imports another
 * module's internals across subsystem boundaries.
 */

// ---------------------------------------------------------------------------
// Currencies
// ---------------------------------------------------------------------------

/** Spendable / accumulating currencies. */
export interface CurrencyBalances {
  /** Main currency, earned per mile driven and from road pickups. */
  coins: number;
  /** Prestige currency ("Horizon Tokens"), earned by starting a New Journey. */
  tokens: number;
  /** Rare roadside collectibles, biome-flavored. Spent on special cars. */
  relics: number;
}

export type CurrencyId = keyof CurrencyBalances;

// ---------------------------------------------------------------------------
// Time / weather / biomes
// ---------------------------------------------------------------------------

export type TimePhase = 'dawn' | 'day' | 'sunset' | 'night';

export type WeatherId = 'clear' | 'rain' | 'fog' | 'leaves' | 'aurora';

export type BiomeId =
  | 'meadow' // rolling green meadows
  | 'farmland' // golden wheat
  | 'autumn' // HERO biome: deep oranges/reds, dramatic sunsets
  | 'lavender' // purple fields
  | 'cherry' // blossom groves, pink petals
  | 'wetland' // misty marsh at dawn
  | 'pine' // cool misty pine hills
  | 'sunflower'; // bright sunflower fields

export const BIOME_ORDER: BiomeId[] = [
  'meadow',
  'farmland',
  'sunflower',
  'autumn',
  'pine',
  'lavender',
  'cherry',
  'wetland',
];

export const BIOME_NAMES: Record<BiomeId, string> = {
  meadow: 'Emerald Meadows',
  farmland: 'Amber Farmland',
  sunflower: 'Sunflower Coast',
  autumn: 'Emberwood',
  pine: 'Mistpine Hills',
  lavender: 'Lavender Reach',
  cherry: 'Blossom Vale',
  wetland: 'Dawnmarsh',
};

// ---------------------------------------------------------------------------
// Cars
// ---------------------------------------------------------------------------

/** Every car body type, as a runtime list; the type derives from it. */
export const CAR_BODY_TYPES = [
  'compact',
  'sedan',
  'wagon',
  'pickup',
  'van',
  'classic',
  'sports',
  'muscle',
  'super',
  'hover',
] as const;

export type CarBodyType = (typeof CAR_BODY_TYPES)[number];

export interface CarStyle {
  bodyType: CarBodyType;
  /** Hex color, e.g. '#e86a5a'. */
  bodyColor: string;
  /** Secondary/accent hex color (stripes, roof). */
  accentColor: string;
  /** Uniform scale multiplier for the mesh (1 = normal). */
  scale: number;
}

export interface CarDef {
  id: string;
  name: string;
  /** One-line flavor text shown in the garage. */
  description: string;
  /** Purchase cost. The starter car costs 0. */
  cost: number;
  costCurrency: CurrencyId;
  /** Cruising speed in mph at engine level 0. */
  baseSpeed: number;
  /** Multiplier on coin earnings (1 = baseline). */
  coinMult: number;
  /** Tier 0..n, used for garage sorting and achievement checks. */
  tier: number;
  style: CarStyle;
}

// ---------------------------------------------------------------------------
// Upgrades
// ---------------------------------------------------------------------------

export type UpgradeKind =
  | 'engine' // + top speed
  | 'tuning' // + coin multiplier
  | 'tires' // + drift combo effectiveness
  | 'magnet' // + pickup attraction radius
  | 'chime'; // + relic spot chance / relic value

export interface UpgradeDef {
  id: UpgradeKind;
  name: string;
  description: string;
  maxLevel: number;
  /** Cost of level 1. */
  baseCost: number;
  /** Cost multiplier per level (geometric). */
  costGrowth: number;
  /** Human string like '+6 mph' used by UI, per level. */
  effectLabel: string;
}

/** Permanent prestige-shop upgrades bought with tokens. */
export interface GlobalUpgradeDef {
  id: string;
  name: string;
  description: string;
  maxLevel: number;
  baseCost: number;
  costGrowth: number;
  effectLabel: string;
}

// ---------------------------------------------------------------------------
// Stats (all-time, survives prestige unless noted)
// ---------------------------------------------------------------------------

export interface GameStats {
  lifetimeMiles: number;
  /** Miles this journey; resets on prestige. */
  journeyMiles: number;
  lifetimeCoins: number;
  pickupsCollected: number;
  relicsFound: number;
  driftCount: number;
  driftMiles: number;
  nearMisses: number;
  bestCombo: number;
  activeMiles: number;
  /** Active (hands-on) miles this journey; resets on prestige. */
  journeyActiveMiles: number;
  idleMiles: number;
  nightMiles: number;
  sunsetMiles: number;
  dawnMiles: number;
  rainMiles: number;
  fogMiles: number;
  leafMiles: number;
  auroraMiles: number;
  biomesVisited: BiomeId[];
  weatherSeen: WeatherId[];
  upgradesPurchased: number;
  prestigeCount: number;
  totalTokensEarned: number;
  playTimeSec: number;
  offlineCoinsEarned: number;
  topSpeed: number;
  sessionCount: number;
}

// ---------------------------------------------------------------------------
// Persistent game state (what gets saved)
// ---------------------------------------------------------------------------

export interface GameSettings {
  audioEnabled: boolean;
  musicVolume: number; // 0..1
  sfxVolume: number; // 0..1
  quality: 'low' | 'medium' | 'high';
  showFps: boolean;
}

export interface GameState {
  version: number;
  currencies: CurrencyBalances;
  stats: GameStats;
  currentCarId: string;
  ownedCars: string[];
  /** carId -> upgradeId -> level */
  upgrades: Record<string, Partial<Record<UpgradeKind, number>>>;
  /** globalUpgradeId -> level */
  globalUpgrades: Record<string, number>;
  /** Unlocked achievement ids. */
  achievements: string[];
  settings: GameSettings;
  /** Epoch ms of last save; used for offline progress. */
  lastSaveTime: number;
  /** Epoch ms when the save was first created. */
  createdTime: number;
}

// ---------------------------------------------------------------------------
// App shell (main menu vs. play)
// ---------------------------------------------------------------------------

/**
 * Which shell the app is in. `menu` runs the world purely as attract-mode
 * footage behind the main menu: the sim, sky, weather and audio all run, but
 * nothing is earned, no stat moves and nothing is saved. `playing` is the game.
 */
export type AppMode = 'menu' | 'playing';

/** The one-line "here is what you left behind" the Continue button shows. */
export interface SaveSummary {
  journeyMiles: number;
  lifetimeMiles: number;
  coins: number;
  /** Display name of the saved car, already resolved from the catalog. */
  carName: string;
  prestigeCount: number;
  /** Epoch ms of the last save, for a "2h ago" line. */
  lastSaveTime: number;
}

/**
 * What `saveGame` did with a write (docs/ARCHITECTURE.md §12). Anything other
 * than `ok` means storage was left untouched:
 * - `conflict` — another tab saved after this one loaded, so this tab's
 *   snapshot is stale and writing it would erase the other tab's progress.
 * - `locked` — this session refused a newer-build save it could not back up,
 *   so it is not allowed to write over it.
 * - `error` — storage itself threw (quota exhausted, private mode).
 */
export type SaveWriteResult = 'ok' | 'conflict' | 'locked' | 'error';

// ---------------------------------------------------------------------------
// Runtime state (NOT saved; lives for the session)
// ---------------------------------------------------------------------------

export interface RuntimeState {
  speedMph: number;
  /** True while the player is actively steering. */
  isActive: boolean;
  /** Whether drift is currently engaged. */
  isDrifting: boolean;
  /** Current style combo multiplier (>= 1). */
  combo: number;
  /** Seconds until combo decays. */
  comboTimer: number;
  biomeId: BiomeId;
  nextBiomeId: BiomeId;
  /** 0..1 blend from biomeId -> nextBiomeId. */
  biomeBlend: number;
  /** 0..1 over a full day cycle. 0=midnight. */
  timeOfDay: number;
  timePhase: TimePhase;
  weatherId: WeatherId;
  /** Coins/sec currently being earned (for HUD). */
  coinRate: number;
  fps: number;
  paused: boolean;
  /** Menu (attract footage) vs. play. Set by main.ts, read by the UI. */
  appMode: AppMode;
}

// ---------------------------------------------------------------------------
// Economy module contract  (src/game/economy/)
// ---------------------------------------------------------------------------

/** Per-tick context the engine hands to the economy. */
export interface EconomyContext {
  dtSec: number;
  /** Miles traveled this tick. */
  milesDelta: number;
  isActive: boolean;
  /** Current combo multiplier (>=1). */
  combo: number;
  biomeId: BiomeId;
  timePhase: TimePhase;
  weatherId: WeatherId;
}

export interface TickResult {
  coinsEarned: number;
}

/** What the prestige preview shows. */
export interface PrestigePreview {
  tokensOnPrestige: number;
  /** Miles needed before prestige is allowed. */
  milesRequired: number;
  canPrestige: boolean;
}

// ---------------------------------------------------------------------------
// Achievements module contract  (src/game/achievements/)
// ---------------------------------------------------------------------------

export type AchievementCategory =
  | 'distance'
  | 'wealth'
  | 'garage'
  | 'skill' // drift / near-miss / combo
  | 'explorer' // biomes, weather, time-of-day
  | 'dedication' // playtime, sessions, offline
  | 'prestige'
  | 'secret';

export interface AchievementDef {
  id: string;
  name: string;
  description: string;
  category: AchievementCategory;
  /** Emoji used as the icon. */
  icon: string;
  /** Optional coin/token bounty granted on unlock. */
  reward?: Partial<CurrencyBalances>;
  /** Secret achievements show ??? until unlocked. */
  secret?: boolean;
  /** Returns true when the achievement should unlock. Pure; no side effects. */
  condition: (state: GameState, runtime: RuntimeState) => boolean;
}

// ---------------------------------------------------------------------------
// Event bus
// ---------------------------------------------------------------------------

export interface GameEvents {
  /** Fired when achievements unlock. */
  achievement: { defs: AchievementDef[] };
  pickup: { kind: 'coin' | 'relic'; value: number };
  purchase: { what: 'car' | 'upgrade' | 'global'; id: string };
  carSelected: { id: string };
  prestige: { tokensGained: number };
  biomeChange: { id: BiomeId; name: string };
  weatherChange: { id: WeatherId };
  phaseChange: { phase: TimePhase };
  offlineSummary: { seconds: number; coins: number };
  driftEnd: { miles: number; comboReached: number };
  nearMiss: { comboNow: number };
  toast: { text: string; icon?: string };
  saveExported: { code: string };
  uiPanelChange: { panel: string | null };
  appModeChange: { mode: AppMode };
}

export type EventName = keyof GameEvents;

export interface EventBus {
  on<E extends EventName>(name: E, fn: (payload: GameEvents[E]) => void): () => void;
  emit<E extends EventName>(name: E, payload: GameEvents[E]): void;
}

// ---------------------------------------------------------------------------
// UI module contract  (src/ui/)
// ---------------------------------------------------------------------------

export interface UIActions {
  buyCar(id: string): boolean;
  selectCar(id: string): void;
  buyUpgrade(carId: string, upgradeId: UpgradeKind): boolean;
  buyGlobalUpgrade(id: string): boolean;
  getUpgradeCost(carId: string, upgradeId: UpgradeKind): number;
  getGlobalUpgradeCost(id: string): number;
  getPrestigePreview(): PrestigePreview;
  prestige(): boolean;
  exportSave(): string;
  importSave(code: string): boolean;
  resetSave(): void;
  setAudioEnabled(b: boolean): void;
  setQuality(q: GameSettings['quality']): void;
  /** Effective cruising speed of the current car with upgrades. */
  getCarSpeed(): number;
  /** True when localStorage holds a save worth continuing. */
  hasSave(): boolean;
  /** Summary of the stored save for the menu's Continue button, or null. */
  getSaveSummary(): SaveSummary | null;
  /**
   * Leave the menu and start playing. `continue` resumes the stored save and
   * grants offline progress; `new` erases it and starts a fresh journey.
   */
  startGame(kind: 'continue' | 'new'): void;
  /** Save, then return to the main menu with a freshly randomised attract scene. */
  quitToMenu(): void;
}

export interface UIDeps {
  state: GameState;
  runtime: RuntimeState;
  catalogs: {
    cars: CarDef[];
    upgrades: UpgradeDef[];
    globalUpgrades: GlobalUpgradeDef[];
    achievements: AchievementDef[];
  };
  actions: UIActions;
  bus: EventBus;
}

// ---------------------------------------------------------------------------
// Audio module contract  (src/audio/)
// ---------------------------------------------------------------------------

export interface AudioEngine {
  /** Must be called from a user gesture to unlock WebAudio. Idempotent. */
  start(): void;
  setEnabled(enabled: boolean): void;
  setMusicVolume(v: number): void;
  setSfxVolume(v: number): void;
  /** Called every frame-ish with current world mood. */
  update(mood: {
    biomeId: BiomeId;
    timePhase: TimePhase;
    weatherId: WeatherId;
    speedMph: number;
    isDrifting: boolean;
  }): void;
  onPickup(kind: 'coin' | 'relic'): void;
  onAchievement(): void;
  onPurchase(): void;
  onNearMiss(): void;
  onPrestige(): void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const SAVE_VERSION = 1;

/**
 * Fraction of the car's stated top speed the autopilot cruises at when the
 * player is not holding the throttle. Shared by the vehicle sim and the idle
 * earning rate so projected offline income matches what hands-off play
 * actually earns.
 */
export const AUTOPILOT_CRUISE_FRACTION = 0.94;

/**
 * Format a number compactly: 1.2K, 3.4M, 5.6B ... Values past the last suffix
 * (>= 1e27, beyond Sp) fall back to exponent form, e.g. "1.0e27", so the
 * string stays bounded instead of growing a multi-digit mantissa.
 */
export function formatNumber(n: number): string {
  if (!isFinite(n)) return '∞';
  const abs = Math.abs(n);
  if (abs < 1000) return abs < 10 && n % 1 !== 0 ? n.toFixed(1) : Math.floor(n).toString();
  const units = ['K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp'];
  let u = -1;
  let v = n;
  while (Math.abs(v) >= 1000 && u < units.length - 1) {
    v /= 1000;
    u++;
  }
  // Rounding at display precision can carry the mantissa to 1000
  // (e.g. 999,950 -> "1000K"); promote to the next unit when it does.
  let str = v.toFixed(Math.abs(v) < 100 ? 1 : 0);
  if (Math.abs(Number(str)) >= 1000 && u < units.length - 1) {
    v /= 1000;
    u++;
    str = v.toFixed(1);
  }
  // Suffixes exhausted (mantissa still >= 1000 at 'Sp'): exponent form.
  if (Math.abs(Number(str)) >= 1000) return n.toExponential(1).replace('e+', 'e');
  return `${str}${units[u]}`;
}

/**
 * Format a miles readout: exact tenths below 10,000 mi, compact
 * (formatNumber) above, so long runs never grow an unbounded-width string.
 */
export function formatMiles(mi: number): string {
  return mi >= 10_000 ? formatNumber(mi) : mi.toFixed(1);
}

/** Format seconds as "2h 14m" / "3d 4h" / "45s". */
export function formatDuration(sec: number): string {
  sec = Math.max(0, Math.floor(sec));
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
