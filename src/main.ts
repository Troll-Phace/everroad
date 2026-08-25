import * as THREE from 'three';
import './style.css';
import { createEventBus } from './events';
import { defaultState, defaultRuntime, newJourneyState } from './state';
import type {
  BiomeId,
  EconomyContext,
  GameState,
  SaveSummary,
  SaveWriteResult,
  UIActions,
  UIDeps,
} from './types';
import { BIOME_NAMES, BIOME_ORDER } from './types';
import { Input } from './engine/input';
import { DayNight } from './engine/daynight';
import { RoadPath } from './world/roadPath';
import { CHUNK_LEN, ChunkManager, MENU_BEHIND, PLAY_BEHIND, type CoverEye } from './world/chunks';
import { GrassField, windStrength } from './world/grass';
import { Sky } from './world/sky';
import { FarLand } from './world/farLand';
import { START_S, Vehicle } from './world/vehicle';
import { ChaseCamera } from './world/camera';
import { MenuCamera } from './world/menuCamera';
import { Weather } from './world/weather';
import { Pickups } from './world/pickups';
import { PostFX } from './world/postfx';
import { SunShadow } from './world/sunShadow';
import {
  BIOMES,
  biomeAt,
  blendColor,
  blendNumber,
  createBiomeSample,
  sForBiome,
} from './world/biomes';
import * as economy from './game/economy/economy';
import { CARS, getCarDef } from './game/economy/cars';
import { UPGRADES, GLOBAL_UPGRADES } from './game/economy/upgrades';
import { ACHIEVEMENTS } from './game/achievements/definitions';
import { checkAchievements } from './game/achievements/tracker';
import { updateSlowDrive } from './game/achievements/slowDrive';
import { createAudioEngine } from './audio/audio';
import * as save from './save/save';
import { initUI } from './ui/ui';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const bus = createEventBus();
const state: GameState = save.loadGame() ?? defaultState();
economy.initEconomy(state);
const runtime = defaultRuntime();
// The session bump and the offline grant used to happen here. They now live in
// startGame(), because the app boots into the main menu and only Continue is a
// return to a journey. The gap is measured to the instant the menu was entered
// (`menuEnteredMs`), never to "now": quitToMenu() saves on the way out, so
// measuring to now would pay the player for the time the title screen sat
// there — a night on the menu would read as a night of idle earnings — while
// measuring to the menu-entry instant yields the true away time at boot and
// zero after a quit.

/** What the player is told about each kind of refused write. */
const SAVE_REFUSAL_TEXT: Record<Exclude<SaveWriteResult, 'ok'>, string> = {
  conflict: 'Another tab saved newer progress — this tab has stopped saving. Reload to catch up.',
  locked: 'A save from a newer version is in the way — this tab will not save over it.',
  error: 'Storage is full or blocked — your progress is not being saved.',
};

/**
 * A refused write waiting to be shown, and whether one already has been. The
 * two are kept apart on purpose: raising the toast in the same breath as the
 * refusal would latch "already warned" even when nothing reached the player —
 * `gameToast` drops anything raised outside `playing`, and the write on
 * `visibilitychange` happens as the tab goes away, where a 4.5s toast expires
 * unseen. The frame loop flushes it at a moment the player is actually there.
 */
let saveRefusalPending: Exclude<SaveWriteResult, 'ok'> | null = null;
let saveRefusalWarned = false;

/**
 * Every write to the save goes through here. `saveGame` can refuse — another
 * tab has saved since this one loaded, or this session may not write over a
 * newer-build save it could not back up (docs/ARCHITECTURE.md §12) — and it can
 * simply fail on full or blocked storage. All three mean the player is no
 * longer being saved, so all three queue the warning; the result is returned
 * for callers that need to act on it rather than merely report it.
 */
function persist(target: GameState = state): SaveWriteResult {
  const result = save.saveGame(target);
  if (result !== 'ok' && !saveRefusalWarned && !saveRefusalPending) saveRefusalPending = result;
  return result;
}

/** Raise the queued save warning, once, when the player can see it. */
function flushSaveRefusal(): void {
  if (!saveRefusalPending || runtime.appMode !== 'playing' || document.hidden) return;
  const result = saveRefusalPending;
  saveRefusalPending = null;
  saveRefusalWarned = true;
  bus.emit('toast', { text: SAVE_REFUSAL_TEXT[result], icon: '⚠️' });
}

// ---------------------------------------------------------------------------
// Renderer & scene
// ---------------------------------------------------------------------------

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.shadowMap.enabled = true;
// PCF, not PCFSoft: three r185 deprecated PCFSoftShadowMap and silently swaps
// it for PCFShadowMap on the first shadow render, warning once per boot. The
// game has therefore been rendering PCF shadows all along, so naming it here
// changes the console, not a pixel. src/tools/modelViewer.ts mirrors this.
renderer.shadowMap.type = THREE.PCFShadowMap;

/**
 * Base `FogExp2` density in clear weather at `mist: 1.0`, before the biome and
 * weather multipliers below.
 *
 * `FogExp2` extinguishes contrast as `exp(-(d * density)^2)`, so this number is
 * really a choice of how far the world keeps its colour. At the 0.0038 this
 * shipped with, 400 m was 90% hazed and 500 m 97%: past a couple of hundred
 * metres the whole frame was one flat tone, which is the "distant terrain goes
 * white" report. At 0.0014 the same land is 27% hazed at 400 m and 51% at
 * 600 m, and does not saturate until roughly a kilometre out.
 *
 * The ceiling is the terrain ribbon, not taste. It ends at `AHEAD * CHUNK_LEN`
 * = 1320 m, and the haze is what hides that cut: at 0.0014 the last row keeps
 * 3.6% of its contrast (6.3% at the thinnest biome), which `world/farLand.ts`
 * meets from behind at the same value. Thinner than this and `AHEAD` has to
 * rise to match, which is chunk build time and memory (§14).
 */
const FOG_BASE_DENSITY = 0.0014;

/**
 * The daylight haze colour distant land trends to.
 *
 * A desaturated sky blue, deliberately not white. Aerial perspective is light
 * scattered *into* the sight line by air, which is the same blue the sky is;
 * the milky look came from mixing a pale biome tint into an already pale
 * daytime horizon and landing on nothing in particular.
 */
const AERIAL_HAZE = new THREE.Color('#7b9cc0');

/**
 * Biome `fogTint`'s share of the fog colour.
 *
 * Was 0.42, which made the tint most of the answer and the horizon a pale
 * wash of it. At 0.16 the tint is what it says it is in `biomes.ts` — a subtle
 * identity, Emberwood's haze warmer than Mistpine's — while the sky and the
 * aerial blue decide the actual colour.
 */
const FOG_BIOME_TINT = 0.16;

/**
 * How far up the dome the haze takes its base colour, 0 = horizon, 1 = zenith.
 *
 * Aerial perspective converges on the sky the land is seen *against*, and the
 * land is not seen against the horizon: `world/farLand.ts` saturates to this
 * colour at its crest, which sits 9.2-10.9° above a low eye, and the sky
 * immediately over that crest is a degree or two higher still. The sky dome is
 * `mix(uHorizon, uZenith, sqrt(dir.y))` (see the shader in `world/sky.ts`), so
 * the colour at elevation θ is that mix at `sqrt(sin θ)` — 0.45 at 11.7°.
 * Derived, then confirmed: at the meadow default the fan's top row lands within
 * 5/255 of the sky pixel above it in every channel, against 12/7/26 before.
 *
 * This is what replaces `FOG_SHADE`, which used to darken the haze by a tenth
 * so the far band would not dissolve into the horizon. That was a real problem
 * with a flat lid for a backdrop and is not one now — the backdrop carries its
 * own gradient from land colour at the foot of the band to air at the top — and
 * measured against the sky, any shade at all re-opens the hard edge this
 * removes: 0.03 of it puts 11/255 of blue back.
 */
const FOG_SKY_RISE = 0.45;

/**
 * How far the daylight fog is pulled from that sky colour toward
 * `AERIAL_HAZE`. Backed off through golden hour, where the scattered light
 * genuinely is warm and a blue haze would grey out the sunset, and to zero at
 * night, where the horizon is already dark and cool.
 *
 * Was 0.4, which was most of the reason the backdrop stepped against the sky:
 * `AERIAL_HAZE` is duller than the sky at every hour, so a heavy pull toward it
 * lands the haze somewhere the sky never is. With the base colour now taken off
 * the dome itself the mix has less work to do — it is the biome-independent
 * blue that keeps mid-distance land from tinting the whole horizon, not the
 * thing that decides the colour. Swept against the same measurement: 0.10 and
 * 0.20 both sit further from the sky than this does.
 */
const FOG_AERIAL_MIX = 0.15;

const scene = new THREE.Scene();
// Replaced on the first rendered frame by the loop below; this is only what
// the scene holds while it is being built.
scene.fog = new THREE.FogExp2('#b6cbdd', FOG_BASE_DENSITY);

const hemi = new THREE.HemisphereLight('#bfe3ff', '#7ec850', 0.75);
scene.add(hemi);
// The shadow rig owns the light's placement, shadow camera and night gating;
// colour and intensity are driven from the sky below.
const sunShadow = new SunShadow(scene, '#fff2d9', 1.6);
const sun = sunShadow.light;

// ---------------------------------------------------------------------------
// World systems
// ---------------------------------------------------------------------------

const input = new Input();
const daynight = new DayNight(runtime.timeOfDay);
const path = new RoadPath(20260824);
// Dense instanced ground cover. Built for a near band of chunks only and
// hung on their groups, so it rides the floating-origin rebase and the chunk
// cull for free (docs/ARCHITECTURE.md §5.7).
const grass = new GrassField(state.settings.quality);
const chunks = new ChunkManager(path, scene, grass);
const sky = new Sky(scene);
// Distant land past the terrain ribbon's lateral edge (docs/ARCHITECTURE.md §5.3).
const farLand = new FarLand(scene);
const weather = new Weather(scene, bus);
const audio = createAudioEngine();

/**
 * Cruise speed for attract mode, in mph, or null while playing.
 *
 * The showreel car is drawn from the whole catalog and is not the player's, so
 * it runs at its own `baseSpeed` with no upgrades applied — otherwise every
 * car in the reel would crawl at whatever the player's garage is worth, and a
 * hover supercar doing 42 mph does not read as a supercar. Latched in
 * `enterMenu` and cleared in `startGame`, so the source of truth never depends
 * on where `runtime.appMode` is written within those functions.
 */
let menuCruiseMph: number | null = null;

const vehicle = new Vehicle(
  path,
  input,
  bus,
  () => menuCruiseMph ?? economy.getCarSpeed(state),
  () => pickups.combo,
  getCarDef(state.currentCarId).style,
);
scene.add(vehicle.root);

const pickups = new Pickups(scene, path, chunks, bus, {
  getMagnetRadius: () => economy.getMagnetRadius(state),
  getPickupCoinValue: (combo) => economy.getPickupCoinValue(state, combo),
  getRelicChancePerMile: () => economy.getRelicChancePerMile(state),
  getComboCap: () => economy.getComboCap(state),
  getComboDuration: () => economy.getComboDuration(state),
  // Attract mode still runs pickups so coins glint on the road, but nothing
  // it touches may reach the save: every payout callback is a no-op in the
  // menu (docs/ARCHITECTURE.md §4.1).
  onCoins: (amount) => {
    if (runtime.appMode === 'menu') return;
    state.currencies.coins += amount;
    state.stats.lifetimeCoins += amount;
    state.stats.pickupsCollected += 1;
  },
  onRelic: () => {
    if (runtime.appMode === 'menu') return;
    state.currencies.relics += 1;
    state.stats.relicsFound += 1;
  },
  onNearMiss: () => {
    if (runtime.appMode === 'menu') return;
    state.stats.nearMisses += 1;
  },
});

const chase = new ChaseCamera(window.innerWidth / window.innerHeight);
const postfx = new PostFX(renderer, scene, chase.camera, sky.sun);
postfx.setQuality(state.settings.quality);
postfx.setSize(window.innerWidth, window.innerHeight);

// ---------------------------------------------------------------------------
// UI wiring
// ---------------------------------------------------------------------------

function replaceState(next: GameState): void {
  Object.assign(state, next);
  economy.initEconomy(state);
  vehicle.setStyle(getCarDef(state.currentCarId).style);
  // Imported/reset settings must reach the systems that otherwise only read
  // them at boot or through their own UI actions.
  postfx.setQuality(state.settings.quality);
  grass.setQuality(state.settings.quality);
  audio.setEnabled(state.settings.audioEnabled);
}

const actions: UIActions = {
  buyCar(id) {
    const ok = economy.buyCar(state, id);
    if (ok) {
      bus.emit('purchase', { what: 'car', id });
      audio.onPurchase();
    }
    return ok;
  },
  selectCar(id) {
    if (economy.selectCar(state, id)) {
      vehicle.setStyle(getCarDef(id).style);
      bus.emit('carSelected', { id });
    }
  },
  buyUpgrade(carId, upgradeId) {
    const ok = economy.buyUpgrade(state, carId, upgradeId);
    if (ok) {
      bus.emit('purchase', { what: 'upgrade', id: upgradeId });
      audio.onPurchase();
    }
    return ok;
  },
  buyGlobalUpgrade(id) {
    const ok = economy.buyGlobalUpgrade(state, id);
    if (ok) {
      bus.emit('purchase', { what: 'global', id });
      audio.onPurchase();
    }
    return ok;
  },
  getUpgradeCost: (carId, upgradeId) => economy.getUpgradeCost(state, carId, upgradeId),
  getGlobalUpgradeCost: (id) => economy.getGlobalUpgradeCost(state, id),
  getPrestigePreview: () => economy.getPrestigePreview(state),
  prestige() {
    const preview = economy.getPrestigePreview(state);
    if (!preview.canPrestige) return false;
    const tokens = economy.doPrestige(state);
    bus.emit('prestige', { tokensGained: tokens });
    audio.onPrestige();
    persist();
    return true;
  },
  exportSave: () => save.exportSave(state),
  importSave(code) {
    const imported = save.importSave(code);
    if (!imported) return false;
    // Sanitised, then written, and only adopted if the write landed: a refused
    // write must not leave the game running a journey that was never
    // persisted. The panel shows its inline error on `false`.
    economy.initEconomy(imported);
    if (persist(imported) !== 'ok') return false;
    replaceState(imported);
    bus.emit('toast', { text: 'Save imported', icon: '💾' });
    return true;
  },
  resetSave() {
    save.clearSave();
    replaceState(defaultState());
    bus.emit('toast', { text: 'A fresh road awaits', icon: '🌄' });
  },
  setAudioEnabled(b) {
    state.settings.audioEnabled = b;
    audio.setEnabled(b);
  },
  setQuality(q) {
    state.settings.quality = q;
    postfx.setQuality(q);
    // Same path PostFX takes: the field re-shapes its proto and shader, and
    // ChunkManager rebuilds the near band on the next update().
    grass.setQuality(q);
  },
  getCarSpeed: () => economy.getCarSpeed(state),
  hasSave: () => save.hasSave(),
  getSaveSummary(): SaveSummary | null {
    // Built from the state loaded at boot; hasSave() is what decides whether
    // there is anything worth summarising in the first place.
    if (!save.hasSave()) return null;
    return {
      journeyMiles: state.stats.journeyMiles,
      lifetimeMiles: state.stats.lifetimeMiles,
      coins: state.currencies.coins,
      carName: getCarDef(state.currentCarId).name,
      prestigeCount: state.stats.prestigeCount,
      lastSaveTime: state.lastSaveTime,
    };
  },
  startGame: (kind) => startGame(kind),
  quitToMenu: () => quitToMenu(),
};

const uiDeps: UIDeps = {
  state,
  runtime,
  catalogs: {
    cars: CARS,
    upgrades: UPGRADES,
    globalUpgrades: GLOBAL_UPGRADES,
    achievements: ACHIEVEMENTS,
  },
  actions,
  bus,
};
initUI(uiDeps);

// Audio unlock on first gesture + SFX hooks.
const unlock = () => {
  audio.start();
  audio.setEnabled(state.settings.audioEnabled);
  audio.setMusicVolume(state.settings.musicVolume);
  audio.setSfxVolume(state.settings.sfxVolume);
  window.removeEventListener('pointerdown', unlock);
  window.removeEventListener('keydown', unlock);
};
window.addEventListener('pointerdown', unlock);
window.addEventListener('keydown', unlock);

bus.on('pickup', ({ kind }) => audio.onPickup(kind));
bus.on('nearMiss', () => audio.onNearMiss());
bus.on('achievement', () => audio.onAchievement());
bus.on('driftEnd', ({ miles }) => {
  if (runtime.appMode === 'menu') return;
  state.stats.driftCount += 1;
  state.stats.driftMiles += miles;
});

// Track settings volume changes made directly by the settings panel.
let lastMusicVol = state.settings.musicVolume;
let lastSfxVol = state.settings.sfxVolume;

// Biome accent color for the glass UI.
function applyAccent(biomeId: keyof typeof BIOMES): void {
  const c = new THREE.Color(BIOMES[biomeId].canopy[0]);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, Math.min(1, hsl.s * 1.1 + 0.15), Math.min(0.75, hsl.l + 0.22));
  const hex = `#${c.getHexString()}`;
  document.documentElement.style.setProperty('--accent', hex);
  document.documentElement.style.setProperty('--accent-soft', `${hex}40`);
}

// ---------------------------------------------------------------------------
// App mode: main menu (attract footage) <-> playing
// ---------------------------------------------------------------------------

// The cinematic director borrows the chase rig's camera — PostFX captured that
// one instance at construction, so a second camera would never be rendered.
const menuCam = new MenuCamera(chase.camera, path);

/**
 * Times of day attract mode draws from, weighted toward flattering light.
 * Spans are in DayNight's 0..1 clock (dawn < 0.11, day < 0.55, sunset < 0.72,
 * night beyond); night is deliberately the rarest draw at ~14%.
 */
const MENU_TIME_WINDOWS: Array<{ from: number; to: number; weight: number }> = [
  { from: 0.05, to: 0.12, weight: 3 }, // dawn glow
  { from: 0.14, to: 0.5, weight: 3 }, // open day
  { from: 0.55, to: 0.69, weight: 3.5 }, // golden hour into sunset
  { from: 0.74, to: 0.95, weight: 1.5 }, // night, rarer
];

function randomMenuTimeOfDay(): number {
  let total = 0;
  for (const w of MENU_TIME_WINDOWS) total += w.weight;
  let roll = Math.random() * total;
  for (const w of MENU_TIME_WINDOWS) {
    roll -= w.weight;
    if (roll <= 0) return w.from + Math.random() * (w.to - w.from);
  }
  return 0.38;
}

/**
 * Road kept behind the car when the path is re-seeded. ChunkManager retains
 * `chunks.behind` chunks behind the car and builds each one from `path.pose`,
 * which clamps to the stored sample window — re-seeding exactly at the car
 * would collapse those chunks onto the first sample. Two chunks of slack.
 *
 * Read from the manager rather than from a constant: attract mode keeps a far
 * longer tail behind the car than driving does (`MENU_BEHIND`), and a margin
 * sized for the shorter one would re-seed those extra chunks off a clamped
 * lookup — a flat ramp of land where the road behind should be.
 */
function reseedMargin(): number {
  return (chunks.behind + 2) * CHUNK_LEN;
}

/**
 * This module's own `biomeAt` out-param (docs/ARCHITECTURE.md §14). `biomeAt`
 * writes into a shared scratch by default, and `blendColor`/`blendNumber` call
 * it several times further down the same frame — owning the sample here is
 * what keeps those calls from rewriting a result this file is still reading.
 * `seedWorldAt` and the frame loop never interleave, so one sample serves both.
 */
const worldBiome = createBiomeSample();

/**
 * Re-seed every world system for a teleport along the road. The path is
 * re-anchored at `s` (see RoadPath.reset for why a backwards jump needs it),
 * so chunks and pickups — both keyed to absolute positions — are dropped in
 * the same breath, and the biome-derived visuals are refreshed before the
 * frame that follows.
 */
function seedWorldAt(s: number): void {
  path.reset(s - reseedMargin());
  chunks.reset();
  vehicle.resetTo(s);
  pickups.reset(s);
  // `path.reset` re-bases the curve's origin, so terrain heights are measured
  // in a different world from here on and the backdrop's damped anchor is
  // holding a number that no longer means anything.
  farLand.reanchor();
  // Ribbon only. Ground cover is banded around the camera, which has not been
  // placed for the new position yet, so each caller runs `chunks.updateCover`
  // once it has moved its own rig — see `enterMenu` and `startGame`.
  chunks.update(vehicle.s);

  const biome = biomeAt(vehicle.s, worldBiome);
  runtime.biomeId = biome.id;
  runtime.nextBiomeId = biome.next;
  runtime.biomeBlend = biome.blend;
  weather.retintLeaves(runtime.biomeId);
  applyAccent(runtime.biomeId);

  runtime.speedMph = vehicle.speedMph;
  runtime.isActive = false;
  runtime.isDrifting = false;
  runtime.combo = 1;
  runtime.comboTimer = 0;
  runtime.coinRate = 0;
}

/**
 * Wall-clock instant the app last entered the main menu. The offline grant
 * measures to this rather than to `Date.now()`, so time spent on the title
 * screen is never credited — see `grantOfflineProgress`.
 */
let menuEnteredMs = 0;

/**
 * The menu director's vantage, in the shape `ChunkManager` bands ground cover
 * against (`world/chunks.ts`'s `CoverEye`). Attract mode is the only time the
 * eye and the car are not the same place: `roadsideStatic` stands up to
 * `MENU_MAX_LEAD` = 260 m ahead of the car, well past the far edge of a band
 * centred on it.
 *
 * A live view of `menuCam.camS` rather than a copy, so it cannot be read stale
 * and costs no allocation to hand over. Every reader takes it *after* the
 * director has placed the eye for the frame — see `chunks.updateCover`.
 */
const menuCoverEye: CoverEye = {
  get s(): number {
    return menuCam.camS;
  },
};

/**
 * Enter (or re-enter) the main menu: a randomly-drawn car in a randomly-drawn
 * biome under randomly-drawn light, shot by the cinematic director. Nothing is
 * earned and nothing is saved while this runs — see the frame loop's
 * `menuMode` guards.
 *
 * Called once before the first rendered frame so the loading screen lifts onto
 * the already-correct biome rather than flashing the meadow.
 */
function enterMenu(): void {
  runtime.appMode = 'menu';
  // The cinematic rig looks back down the road from vantages the chase camera
  // never takes, so the ribbon has to reach far enough behind the car for its
  // rear boundary to sit in the fog rather than in shot. Set before
  // `seedWorldAt` below, which is what builds the chunks.
  chunks.setBehind(MENU_BEHIND);
  runtime.paused = true;
  input.setEnabled(false);
  // Latched so the offline grant on Continue measures the player's real time
  // away rather than the time they left the title screen running.
  menuEnteredMs = Date.now();

  // A showreel, not the player's garage: any car in the catalog may appear,
  // driving at its own catalog speed (see menuCruiseMph).
  const showcase = CARS[Math.floor(Math.random() * CARS.length)];
  menuCruiseMph = showcase.baseSpeed;
  vehicle.setStyle(showcase.style);

  const biomeId: BiomeId = BIOME_ORDER[Math.floor(Math.random() * BIOME_ORDER.length)];
  seedWorldAt(sForBiome(biomeId, 0.25 + Math.random() * 0.4));

  daynight.setTimeOfDay(randomMenuTimeOfDay());
  const snap = daynight.update(0);
  runtime.timeOfDay = daynight.timeOfDay;
  runtime.timePhase = snap.phase;

  // Weather is re-drawn with the rest of the scene, after the biome and the
  // light are settled so the draw can see both — otherwise the episode that
  // was running carries over and leaves fall over pines (issue #43).
  weather.reseed(runtime.biomeId, runtime.timePhase);
  runtime.weatherId = weather.current;

  menuCam.reset();
  menuCam.update(vehicle, 0);
  // Ground cover is banded around the eye, so it is built once the director
  // has placed one — the same order the frame loop keeps. Doing it here rather
  // than leaving it to the first frame is what stops the menu opening on a
  // vantage standing in bare dirt.
  chunks.updateCover(vehicle.s, menuCoverEye);

  bus.emit('appModeChange', { mode: 'menu' });
}

/**
 * Grant offline progress for the gap the player was actually away. Only ever
 * runs on Continue: a new journey has nothing to be away from.
 *
 * The window measured is `lastSaveTime -> menuEnteredMs`, not
 * `lastSaveTime -> now`. Both ends matter:
 * - Menu time must not be *credited*. `quitToMenu` saves on the way out, so a
 *   session left sitting on the title screen would otherwise bank a full
 *   night of idle coins the player never earned. Measuring to the menu-entry
 *   instant makes a quit-and-continue worth exactly 0 (offlineSeconds clamps
 *   negatives), while a fresh boot still yields the true time away.
 * - Menu time must not be *eaten* either, which is why nothing writes a save
 *   while the menu is up (see the autosave and unload guards).
 *
 * Dev-only: `?fakeaway=7200` simulates returning after N seconds away.
 */
function grantOfflineProgress(): void {
  const fakeAway = import.meta.env.DEV
    ? Number(new URLSearchParams(location.search).get('fakeaway') ?? 0)
    : 0;
  const awaySec = fakeAway > 0 ? fakeAway : save.offlineSeconds(state, menuEnteredMs);
  console.info(`[everroad] away ${Math.round(awaySec)}s`);
  if (awaySec <= 60) return;
  const coins = economy.getIdleCoinsPerSec(state) * awaySec;
  state.currencies.coins += coins;
  state.stats.lifetimeCoins += coins;
  state.stats.offlineCoinsEarned += coins;
  // Delayed so the welcome-back modal lands after the UI's fade back in; the
  // UI owns all transition timing, this is only the notification.
  setTimeout(() => bus.emit('offlineSummary', { seconds: awaySec, coins }), 900);
}

/**
 * Leave the menu and start playing. Synchronous and instantaneous by contract:
 * the UI fades to black, calls this, and fades back in, so nothing here may
 * schedule world changes on a timer.
 */
function startGame(kind: 'continue' | 'new'): void {
  // The player's car again, at the player's speed: drop the showreel override
  // before anything re-seeds the vehicle.
  menuCruiseMph = null;
  // Hand the menu's long rear tail back: nothing in play ever looks at it, and
  // `seedWorldAt` below is where the extra chunks stop being built.
  chunks.setBehind(PLAY_BEHIND);

  if (kind === 'new') {
    save.clearSave();
    // Settings ride across: "New Journey" erases the journey, not the player's
    // audio and graphics preferences (that is what "Erase EVERYTHING" is for).
    // Routed through replaceState so the preserved quality and audio values
    // reach the systems that otherwise only read them at boot.
    // replaceState also applies the new journey's car style, which is the rig
    // build for this path — a second setStyle here would build it twice
    // (issue #44), so the style is only re-applied on the branch that needs it.
    replaceState(newJourneyState(state.settings));
    // defaultStats seeds sessionCount 0; a brand-new journey is session 1.
    state.stats.sessionCount = 1;
  } else {
    // A returning save lands on 2+ here and earns "Welcome Back".
    state.stats.sessionCount += 1;
    // Continue hydrates state without going through replaceState, so nothing
    // has told the rig which car it is: the menu left the showreel car on it.
    vehicle.setStyle(getCarDef(state.currentCarId).style);
    grantOfflineProgress();
  }

  seedWorldAt(START_S);
  // Cut, don't swoop: without this the chase rig would lerp in from wherever
  // the cinematic camera happened to be parked.
  chase.snapTo(vehicle);
  // Cover for the rig that now holds the frame. No cinematic eye: the chase
  // camera rides the car, so the band this resolves is the car's own — the
  // same chunks play built before any of this existed. Built here, behind the
  // UI's fade, rather than on the first rendered frame.
  chunks.updateCover(vehicle.s, null);

  achTimer = 0;
  saveTimer = 0;
  input.setEnabled(true);
  runtime.appMode = 'playing';
  runtime.paused = false;
  bus.emit('appModeChange', { mode: 'playing' });
}

/** Save, then drop back to a freshly-randomised attract scene. */
function quitToMenu(): void {
  persist();
  enterMenu();
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

const fogColor = new THREE.Color();
const fogTint = new THREE.Color();
const groundTint = new THREE.Color();
// Lerp targets, hoisted: the frame loop holds a zero steady-state allocation
// budget (docs/ARCHITECTURE.md §14).
const MOONLIT_TINT = new THREE.Color('#9db8e8');
const WHITE = new THREE.Color('#ffffff');
let lastNow = performance.now();
let achTimer = 0;
let saveTimer = 0;
let fpsSmooth = 60;
let firstFrame = true;

function frame(now: number): void {
  requestAnimationFrame(frame);
  let dt = (now - lastNow) / 1000;
  lastNow = now;
  // Attract mode behind the main menu: the world runs in full, but nothing is
  // earned, no stat moves and nothing is written to storage.
  const menuMode = runtime.appMode === 'menu';

  // Hidden/throttled tab: sim can't keep up, so bank the surplus time as
  // idle earnings instead of playing in slow motion.
  if (dt > 0.5) {
    if (!menuMode) {
      const gapSec = dt - 1 / 60;
      const gapCoins = economy.getIdleCoinsPerSec(state) * gapSec;
      state.currencies.coins += gapCoins;
      state.stats.lifetimeCoins += gapCoins;
      state.stats.offlineCoinsEarned += gapCoins;
      if (dt > 60) bus.emit('offlineSummary', { seconds: dt, coins: gapCoins });
    }
    dt = 1 / 60;
  }
  dt = Math.min(dt, 0.1);
  fpsSmooth = THREE.MathUtils.lerp(fpsSmooth, 1 / Math.max(dt, 1e-4), 0.05);
  runtime.fps = Math.round(fpsSmooth);

  // ---- simulation ----
  input.update(dt);
  vehicle.update(dt);

  // ---- floating origin ----
  // Rebase immediately after the vehicle moves and before anything is placed
  // for this frame, so no system ever renders one frame in mixed coordinates.
  // Everything downstream (chunks, pickups, camera, sky, sun light, weather)
  // re-derives its placement from the shifted path/positions this same frame.
  {
    const pos = vehicle.root.position;
    if (Math.abs(pos.x) > 2048 || Math.abs(pos.z) > 2048) {
      const dx = -Math.round(pos.x);
      const dz = -Math.round(pos.z);
      path.shiftOrigin(dx, dz);
      vehicle.shiftOrigin(dx, dz);
      chunks.shiftOrigin(dx, dz);
      chase.shiftOrigin(dx, dz);
      // Cinematic shots are composed in road coordinates, so only the menu
      // camera's damped look target travels with the rebase.
      menuCam.shiftOrigin(dx, dz);
      weather.shiftOrigin(dx, dz);
      pickups.shiftOrigin(dx, dz);
    }
  }

  const snap = daynight.update(dt);
  runtime.timeOfDay = daynight.timeOfDay;
  if (snap.phase !== runtime.timePhase) {
    runtime.timePhase = snap.phase;
    bus.emit('phaseChange', { phase: snap.phase });
  }

  const milesDelta = (vehicle.speedMps * dt) / 1609.34;
  // Ribbon first, ground cover much later. This has to precede the camera
  // block: the menu director samples the terrain these chunks own to choose
  // and clear its vantage. The cover pass is the other half of it and runs
  // *after* the camera, deliberately — see `chunks.updateCover` below.
  chunks.update(vehicle.s);
  pickups.update(dt, vehicle, milesDelta);

  runtime.speedMph = vehicle.speedMph;
  runtime.isActive = vehicle.isActive;
  runtime.isDrifting = vehicle.isDrifting;
  runtime.combo = pickups.combo;
  runtime.comboTimer = pickups.comboTimer;
  if (!menuMode) {
    updateSlowDrive(dt, runtime.speedMph, runtime.paused);
    state.stats.topSpeed = Math.max(state.stats.topSpeed, runtime.speedMph);
    state.stats.bestCombo = Math.max(state.stats.bestCombo, runtime.combo);
  }

  // Biome bookkeeping. Read out of the sample immediately: everything below
  // this block may sample biomes again through blendColor/blendNumber.
  const biome = biomeAt(vehicle.s, worldBiome);
  runtime.nextBiomeId = biome.next;
  runtime.biomeBlend = biome.blend;
  const biomeId = biome.id;
  if (biomeId !== runtime.biomeId) {
    runtime.biomeId = biomeId;
    weather.retintLeaves(biomeId);
    applyAccent(biomeId);
    bus.emit('biomeChange', { id: biomeId, name: BIOME_NAMES[biomeId] });
  }

  // ---- camera ----
  // Both rigs drive the same PerspectiveCamera; only one of them per frame.
  // Placed ahead of weather because weather anchors its volume on
  // camera.position: on a rebase frame chase.shiftOrigin writes the chase
  // rig's own (stale, and in menu mode never-updated) pose into the camera, so
  // weather would re-anchor kilometres away for one frame and snap back.
  if (menuMode) menuCam.update(vehicle, dt);
  else chase.update(vehicle, dt);

  // Ground cover is banded around the eye, so it is resolved *after* the
  // camera has been placed for this frame and never before it — moving this
  // back up beside `chunks.update` re-opens the defect it was split out to
  // fix, because a menu cut can jump the eye 260 m in one frame and that
  // frame would render the fresh vantage standing on bare ground. Driving
  // passes no eye at all: the chase rig rides the car, so the band is the
  // car's and the play path builds exactly what it always built.
  chunks.updateCover(vehicle.s, menuMode ? menuCoverEye : null);

  weather.update(
    dt,
    chase.camera.position,
    runtime.biomeId,
    runtime.timePhase,
    vehicle.speedMps,
    now / 1000,
  );
  if (weather.current !== runtime.weatherId) runtime.weatherId = weather.current;
  // Wind: calm in clear weather, gusty in rain, with a lift while leaves are
  // drifting. One uniform tick for every grass chunk in the band.
  grass.tick(dt, windStrength(weather.intensity('rain'), weather.intensity('leaves')));

  // ---- economy tick + achievements ----
  // Both are skipped wholesale in the menu: applyTick is the only writer of
  // state.currencies during play, so not calling it is what makes attract
  // mode provably free of earnings.
  if (!menuMode) {
    const ctx: EconomyContext = {
      dtSec: dt,
      milesDelta,
      isActive: runtime.isActive,
      combo: runtime.isActive ? runtime.combo : 1,
      biomeId: runtime.biomeId,
      timePhase: runtime.timePhase,
      weatherId: runtime.weatherId,
    };
    const tick = economy.applyTick(state, ctx);
    runtime.coinRate = THREE.MathUtils.lerp(
      runtime.coinRate,
      tick.coinsEarned / Math.max(dt, 1e-4),
      0.08,
    );

    achTimer += dt;
    if (achTimer > 1) {
      achTimer = 0;
      const newly = checkAchievements(state, runtime);
      if (newly.length) bus.emit('achievement', { defs: newly });
    }
  }

  // ---- visuals ----
  // The active rig has already placed the camera for this frame, above.
  const camPos = chase.camera.position;
  sky.update(camPos, snap, vehicle.s, weather.auroraStrength, dt);
  // The backdrop stands on the ground under the *camera*, so it takes the
  // camera's own road coordinates — which in attract mode are the director's,
  // as much as MENU_MAX_LEAD down the road from the car.
  farLand.update(
    path,
    camPos,
    menuMode ? menuCam.camS : vehicle.s,
    menuMode ? menuCam.camLat : vehicle.lateral,
    dt,
  );
  postfx.setGolden(snap.golden, snap.elevation > -0.05);

  // Fog: aerial perspective off the sky the far land is actually seen against
  // — not the horizon but a little way up the dome, where the backdrop's crest
  // sits (FOG_SKY_RISE) — carrying a little of the biome's tint; density from
  // mist/weather.
  blendColor(vehicle.s, (b) => b.fogTint, fogTint);
  fogColor
    .copy(sky.horizonColor)
    .lerp(sky.zenithColor, FOG_SKY_RISE)
    .lerp(fogTint, FOG_BIOME_TINT * (1 - snap.nightness * 0.6))
    .lerp(AERIAL_HAZE, FOG_AERIAL_MIX * (1 - snap.golden * 0.5) * (1 - snap.nightness));
  const fog = scene.fog as THREE.FogExp2;
  fog.color.copy(fogColor);
  // blendNumber uses the same road-position weights as every other biome
  // field — the dominant-id flip at blend 0.5 must not pop the density.
  const mist = weather.fogMultiplier(blendNumber(vehicle.s, (b) => b.mist));
  fog.density = FOG_BASE_DENSITY * mist * (1 + snap.nightness * 0.25);

  // Lights follow the sun. The shadow rig re-derives its placement from the
  // car's post-rebase position every frame, so it never caches world coords.
  sunShadow.update(snap, vehicle.root.position, vehicle.yaw);
  const dayI = 1.55 * Math.max(0.12, Math.min(1, (snap.elevation + 0.1) * 3));
  sun.intensity = THREE.MathUtils.lerp(dayI, 0.22, snap.nightness);
  sun.color.copy(sky.sunColor).lerp(MOONLIT_TINT, snap.nightness);
  hemi.color.copy(sky.zenithColor).lerp(WHITE, 0.3);
  blendColor(vehicle.s, (b) => b.ground, groundTint);
  hemi.groundColor.copy(groundTint).multiplyScalar(0.9);
  hemi.intensity = 0.72 - snap.nightness * 0.28;

  // ---- audio ----
  audio.update({
    biomeId: runtime.biomeId,
    timePhase: runtime.timePhase,
    weatherId: runtime.weatherId,
    speedMph: runtime.speedMph,
    isDrifting: runtime.isDrifting,
  });
  if (state.settings.musicVolume !== lastMusicVol) {
    lastMusicVol = state.settings.musicVolume;
    audio.setMusicVolume(lastMusicVol);
  }
  if (state.settings.sfxVolume !== lastSfxVol) {
    lastSfxVol = state.settings.sfxVolume;
    audio.setSfxVolume(lastSfxVol);
  }

  // ---- autosave ----
  // Never in the menu: saveGame stamps lastSaveTime, which would eat the
  // offline progress the player has not collected yet.
  if (!menuMode) {
    saveTimer += dt;
    if (saveTimer > 5) {
      saveTimer = 0;
      persist();
    }
  }
  flushSaveRefusal();

  postfx.render(dt);

  if (firstFrame) {
    firstFrame = false;
    const loader = document.getElementById('loading-screen');
    if (loader) {
      const fill = document.getElementById('loading-fill');
      if (fill) fill.style.width = '100%';
      setTimeout(() => loader.classList.add('done'), 250);
      setTimeout(() => loader.remove(), 1800);
    }
  }
}

// Seeded before the first rendered frame, so the loading screen lifts onto the
// attract scene's own biome rather than flashing the default meadow. initUI has
// already run, so the UI is subscribed in time for this emit.
enterMenu();

requestAnimationFrame(frame);

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  chase.camera.aspect = window.innerWidth / window.innerHeight;
  chase.camera.updateProjectionMatrix();
  postfx.setSize(window.innerWidth, window.innerHeight);
});

// Dev-only debug handle for testing from the console.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__everroad = {
    state,
    runtime,
    vehicle,
    economy,
    save,
    bus,
    daynight,
    weather,
    chunks,
    grass,
    renderer,
    pickups,
    scene,
    path,
    camera: chase.camera,
    chase,
    menuCam,
    enterMenu,
    startGame,
    quitToMenu,
  };
}

// Same reason as the autosave timer: a save written from the menu would stamp
// lastSaveTime and swallow the player's uncollected offline progress.
window.addEventListener('beforeunload', () => {
  if (runtime.appMode === 'playing') persist();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && runtime.appMode === 'playing') persist();
});
