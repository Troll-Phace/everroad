/**
 * Always-visible corner HUD. Updated by a requestAnimationFrame loop that
 * only writes to the DOM when a displayed value actually changes.
 */
import type { UIDeps } from '../types';
import { BIOME_NAMES, formatNumber } from '../types';
import { classToggler, el, replayAnimation, textUpdater } from './dom';
import { CURRENCY_ICONS, TIME_ICONS, WEATHER_ICONS } from './icons';

export function initHUD(deps: UIDeps, root: HTMLElement): void {
  const { state, runtime, catalogs } = deps;

  // ---- top-left: currencies -----------------------------------------------
  const currencies = el('div', 'hud hud-top-left');
  const coinRow = el('div', 'currency-row');
  coinRow.append(el('span', 'currency-icon', CURRENCY_ICONS.coins));
  const coinVal = el('span', 'currency-value mono');
  const coinRate = el('span', 'currency-rate mono');
  coinRow.append(coinVal, coinRate);

  const tokenRow = el('div', 'currency-row hidden');
  tokenRow.append(el('span', 'currency-icon', CURRENCY_ICONS.tokens));
  const tokenVal = el('span', 'currency-value mono');
  tokenRow.append(tokenVal);

  const relicRow = el('div', 'currency-row hidden');
  relicRow.append(el('span', 'currency-icon', CURRENCY_ICONS.relics));
  const relicVal = el('span', 'currency-value mono');
  relicRow.append(relicVal);

  currencies.append(coinRow, tokenRow, relicRow);

  // ---- top-right: world readout -------------------------------------------
  const world = el('div', 'hud hud-top-right');
  const fpsChip = el('span', 'world-fps mono hidden');
  const weatherChip = el('span', 'world-weather hidden');
  const timeChip = el('span', 'world-time');
  const biomeChip = el('span', 'world-biome');
  world.append(fpsChip, weatherChip, timeChip, biomeChip);

  // ---- bottom-left: speedometer -------------------------------------------
  const speedo = el('div', 'hud hud-bottom-left');
  const speedNum = el('div', 'speed-number mono');
  const speedRow = el('div', 'speed-row');
  const speedUnit = el('span', 'speed-unit', 'mph');
  const modePill = el('span', 'pill pill-mode');
  const driftPill = el('span', 'pill pill-drift hidden', 'DRIFT');
  speedRow.append(speedUnit, modePill, driftPill);
  speedo.append(speedNum, speedRow);

  // ---- bottom-center: combo meter -----------------------------------------
  const combo = el('div', 'hud hud-combo hidden');
  const comboVal = el('div', 'combo-value mono');
  const comboTrack = el('div', 'combo-track');
  const comboFill = el('div', 'combo-fill');
  comboTrack.append(comboFill);
  combo.append(comboVal, comboTrack);

  // ---- bottom-right: odometer + trophies ----------------------------------
  const odo = el('div', 'hud hud-bottom-right');
  const journey = el('div', 'odo-journey');
  const journeyVal = el('span', 'mono');
  // "journey" = miles since the last prestige (only a New Journey resets it,
  // never a reload) — label it so it doesn't look like a lifetime-miles clone.
  journey.append(journeyVal, el('span', 'odo-unit', ' mi journey'));
  const lifetime = el('div', 'odo-lifetime');
  const trophies = el('div', 'odo-trophies');
  odo.append(journey, lifetime, trophies);

  root.append(currencies, world, speedo, combo, odo);

  // ---- rAF update loop ----------------------------------------------------
  const setCoin = textUpdater(coinVal);
  const setCoinRate = textUpdater(coinRate);
  const setToken = textUpdater(tokenVal);
  const setRelic = textUpdater(relicVal);
  const setBiome = textUpdater(biomeChip);
  const setTime = textUpdater(timeChip);
  const setWeather = textUpdater(weatherChip);
  const setFps = textUpdater(fpsChip);
  const setSpeed = textUpdater(speedNum);
  const setMode = textUpdater(modePill);
  const setComboVal = textUpdater(comboVal);
  const setJourney = textUpdater(journeyVal);
  const setLifetime = textUpdater(lifetime);
  const setTrophies = textUpdater(trophies);

  const toggleTokenRow = classToggler(tokenRow, 'hidden');
  const toggleRelicRow = classToggler(relicRow, 'hidden');
  const toggleWeather = classToggler(weatherChip, 'hidden');
  const toggleFps = classToggler(fpsChip, 'hidden');
  const toggleManual = classToggler(modePill, 'pill-manual');
  const toggleDriftHidden = classToggler(driftPill, 'hidden');
  const toggleCombo = classToggler(combo, 'hidden');

  // Track token/relic "revealed" so rows never re-hide after first earn.
  let tokensSeen = false;
  let relicsSeen = false;
  let lastCombo = 1;
  let comboTimerMax = 0;
  let lastComboPct = -1;

  function frame(): void {
    const c = state.currencies;
    const s = state.stats;

    // Currencies
    setCoin(formatNumber(c.coins));
    setCoinRate(`+${formatNumber(runtime.coinRate)}/s`);
    tokensSeen = tokensSeen || c.tokens > 0 || s.totalTokensEarned > 0;
    relicsSeen = relicsSeen || c.relics > 0 || s.relicsFound > 0;
    toggleTokenRow(!tokensSeen);
    toggleRelicRow(!relicsSeen);
    if (tokensSeen) setToken(formatNumber(c.tokens));
    if (relicsSeen) setRelic(formatNumber(c.relics));

    // World readout
    setBiome(BIOME_NAMES[runtime.biomeId]);
    setTime(TIME_ICONS[runtime.timePhase]);
    const wIcon = WEATHER_ICONS[runtime.weatherId];
    toggleWeather(wIcon === '');
    if (wIcon !== '') setWeather(wIcon);
    toggleFps(!state.settings.showFps);
    if (state.settings.showFps) setFps(`${Math.round(runtime.fps)} fps`);

    // Speedometer
    setSpeed(String(Math.round(runtime.speedMph)));
    setMode(runtime.isActive ? 'MANUAL' : 'AUTO');
    toggleManual(runtime.isActive);
    toggleDriftHidden(!runtime.isDrifting);

    // Combo meter
    const comboActive = runtime.combo > 1;
    toggleCombo(!comboActive);
    if (comboActive) {
      setComboVal(`×${runtime.combo.toFixed(1)}`);
      if (runtime.combo > lastCombo) replayAnimation(combo, 'combo-pulse');
      // The engine doesn't expose a max timer; track the high-water mark so
      // the bar drains proportionally.
      if (runtime.comboTimer > comboTimerMax) comboTimerMax = runtime.comboTimer;
      const pct = comboTimerMax > 0
        ? Math.round(Math.max(0, Math.min(1, runtime.comboTimer / comboTimerMax)) * 200) / 2
        : 0;
      if (pct !== lastComboPct) {
        lastComboPct = pct;
        comboFill.style.width = `${pct}%`;
      }
    } else {
      comboTimerMax = 0;
    }
    lastCombo = runtime.combo;

    // Odometer
    setJourney(s.journeyMiles.toFixed(1));
    setLifetime(`${formatNumber(s.lifetimeMiles)} mi lifetime`);
    setTrophies(`${state.achievements.length}/${catalogs.achievements.length} 🏆`);

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
