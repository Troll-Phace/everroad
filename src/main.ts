import * as THREE from 'three';
import './style.css';
import { createEventBus } from './events';
import { defaultState, defaultRuntime } from './state';
import type { EconomyContext, GameState, UIActions, UIDeps } from './types';
import { BIOME_NAMES } from './types';
import { Input } from './engine/input';
import { DayNight } from './engine/daynight';
import { RoadPath } from './world/roadPath';
import { ChunkManager } from './world/chunks';
import { Sky } from './world/sky';
import { FarLand } from './world/farLand';
import { Vehicle } from './world/vehicle';
import { ChaseCamera } from './world/camera';
import { Weather } from './world/weather';
import { Pickups } from './world/pickups';
import { PostFX } from './world/postfx';
import { SunShadow } from './world/sunShadow';
import { BIOMES, biomeAt, blendColor, blendNumber } from './world/biomes';
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
// defaultStats seeds sessionCount 0, so a fresh install lands on exactly 1
// here (a returning save lands on 2+ and earns "Welcome Back").
state.stats.sessionCount += 1;
economy.initEconomy(state);
const runtime = defaultRuntime();

// Offline progress (computed before the world spins up).
// Dev-only: ?fakeaway=7200 simulates returning after N seconds away.
const fakeAway = import.meta.env.DEV
  ? Number(new URLSearchParams(location.search).get('fakeaway') ?? 0)
  : 0;
const awaySec = fakeAway > 0 ? fakeAway : save.offlineSeconds(state);
console.info(`[everroad] away ${Math.round(awaySec)}s`);
let offlinePending: { seconds: number; coins: number } | null = null;
if (awaySec > 60) {
  const coins = economy.getIdleCoinsPerSec(state) * awaySec;
  state.currencies.coins += coins;
  state.stats.lifetimeCoins += coins;
  state.stats.offlineCoinsEarned += coins;
  offlinePending = { seconds: awaySec, coins };
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
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2('#d2ecd2', 0.0045);

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
const chunks = new ChunkManager(path, scene);
const sky = new Sky(scene);
// Distant land past the terrain ribbon's lateral edge (docs/ARCHITECTURE.md §5.3).
const farLand = new FarLand(scene);
const weather = new Weather(scene, bus);
const audio = createAudioEngine();

const vehicle = new Vehicle(
  path,
  input,
  bus,
  () => economy.getCarSpeed(state),
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
  onCoins: (amount) => {
    state.currencies.coins += amount;
    state.stats.lifetimeCoins += amount;
    state.stats.pickupsCollected += 1;
  },
  onRelic: () => {
    state.currencies.relics += 1;
    state.stats.relicsFound += 1;
  },
  onNearMiss: () => {
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
    save.saveGame(state);
    return true;
  },
  exportSave: () => save.exportSave(state),
  importSave(code) {
    const imported = save.importSave(code);
    if (!imported) return false;
    replaceState(imported);
    save.saveGame(state);
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
  },
  getCarSpeed: () => economy.getCarSpeed(state),
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
applyAccent(runtime.biomeId);

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

  // Hidden/throttled tab: sim can't keep up, so bank the surplus time as
  // idle earnings instead of playing in slow motion.
  if (dt > 0.5) {
    const gapSec = dt - 1 / 60;
    const gapCoins = economy.getIdleCoinsPerSec(state) * gapSec;
    state.currencies.coins += gapCoins;
    state.stats.lifetimeCoins += gapCoins;
    state.stats.offlineCoinsEarned += gapCoins;
    if (dt > 60) bus.emit('offlineSummary', { seconds: dt, coins: gapCoins });
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
  chunks.update(vehicle.s);
  pickups.update(dt, vehicle, milesDelta);

  runtime.speedMph = vehicle.speedMph;
  updateSlowDrive(dt, runtime.speedMph, runtime.paused);
  runtime.isActive = vehicle.isActive;
  runtime.isDrifting = vehicle.isDrifting;
  runtime.combo = pickups.combo;
  runtime.comboTimer = pickups.comboTimer;
  state.stats.topSpeed = Math.max(state.stats.topSpeed, runtime.speedMph);
  state.stats.bestCombo = Math.max(state.stats.bestCombo, runtime.combo);

  // Biome bookkeeping
  const biome = biomeAt(vehicle.s);
  runtime.nextBiomeId = biome.next;
  runtime.biomeBlend = biome.blend;
  if (biome.id !== runtime.biomeId) {
    runtime.biomeId = biome.id;
    weather.retintLeaves(biome.id);
    applyAccent(biome.id);
    bus.emit('biomeChange', { id: biome.id, name: BIOME_NAMES[biome.id] });
  }

  weather.update(
    dt,
    chase.camera.position,
    runtime.biomeId,
    runtime.timePhase,
    vehicle.speedMps,
    now / 1000,
  );
  if (weather.current !== runtime.weatherId) runtime.weatherId = weather.current;

  // ---- economy tick ----
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

  // ---- achievements (batched) ----
  achTimer += dt;
  if (achTimer > 1) {
    achTimer = 0;
    const newly = checkAchievements(state, runtime);
    if (newly.length) bus.emit('achievement', { defs: newly });
  }

  // ---- visuals ----
  const camPos = chase.camera.position;
  chase.update(vehicle, dt);
  sky.update(camPos, snap, vehicle.s, weather.auroraStrength, dt);
  farLand.update(camPos, vehicle.s);
  postfx.setGolden(snap.golden, snap.elevation > -0.05);

  // Fog: horizon color blended with biome fog tint; density from mist/weather.
  blendColor(vehicle.s, (b) => b.fogTint, fogTint);
  fogColor.copy(sky.horizonColor).lerp(fogTint, 0.42 * (1 - snap.nightness * 0.6));
  const fog = scene.fog as THREE.FogExp2;
  fog.color.copy(fogColor);
  // blendNumber uses the same road-position weights as every other biome
  // field — the dominant-id flip at blend 0.5 must not pop the density.
  const mist = weather.fogMultiplier(blendNumber(vehicle.s, (b) => b.mist));
  fog.density = 0.0038 * mist * (1 + snap.nightness * 0.25);

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
  saveTimer += dt;
  if (saveTimer > 5) {
    saveTimer = 0;
    save.saveGame(state);
  }

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
    if (offlinePending) {
      const pending = offlinePending;
      setTimeout(() => bus.emit('offlineSummary', pending), 900);
    }
  }
}

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
    pickups,
    scene,
    camera: chase.camera,
  };
}

window.addEventListener('beforeunload', () => save.saveGame(state));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) save.saveGame(state);
});
