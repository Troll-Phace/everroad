/**
 * Shared emoji icon maps for the UI.
 */
import type { CurrencyId, TimePhase, WeatherId } from '../types';

export const CURRENCY_ICONS: Record<CurrencyId, string> = {
  coins: '🪙',
  tokens: '🌅',
  relics: '🍁',
};

export const TIME_ICONS: Record<TimePhase, string> = {
  dawn: '🌅',
  day: '🌞',
  sunset: '🌇',
  night: '🌙',
};

/** Weather icons; 'clear' has no icon (HUD hides it). */
export const WEATHER_ICONS: Record<WeatherId, string> = {
  clear: '',
  rain: '🌧️',
  fog: '🌫️',
  leaves: '🍂',
  aurora: '✨',
};
