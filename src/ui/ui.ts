/**
 * Everroad UI module entry point.
 *
 * Owns everything inside #ui-root: corner HUD, center panels, toasts,
 * banners and modals. All mutations flow through deps.actions; state and
 * runtime are read live every frame.
 */
import './ui.css';
import type { UIDeps } from '../types';
import { initEffects } from './effects';
import { initHUD } from './hud';
import { PanelManager } from './panels';
import { garagePanel } from './panelGarage';
import { helpPanel } from './panelHelp';
import { prestigePanel } from './panelPrestige';
import { settingsPanel } from './panelSettings';
import { trophiesPanel } from './panelTrophies';
import { upgradesPanel } from './panelUpgrades';

export function initUI(deps: UIDeps): void {
  const root = document.getElementById('ui-root');
  if (!root) {
    console.error('[ui] #ui-root not found; UI not initialized');
    return;
  }

  const effects = initEffects(deps, root);
  initHUD(deps, root);

  const panels = new PanelManager(deps, root);
  panels.register(garagePanel(deps, panels));
  panels.register(upgradesPanel(deps, panels));
  panels.register(trophiesPanel(deps));
  panels.register(prestigePanel(deps, panels));
  panels.register(settingsPanel(deps, effects));
  panels.register(helpPanel());

  // ---- keyboard -----------------------------------------------------------
  const keyToPanel: Record<string, string> = {
    g: 'garage',
    u: 'upgrades',
    t: 'trophies',
    p: 'prestige',
    h: 'help',
  };

  window.addEventListener('keydown', (e) => {
    // Never swallow keys while the player is typing (save import etc.).
    const target = e.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
    ) {
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    const key = e.key.toLowerCase();
    if (key in keyToPanel) {
      panels.toggle(keyToPanel[key]);
      e.preventDefault();
    } else if (key === 'escape') {
      if (panels.current !== null) panels.close();
      else panels.open('settings');
      e.preventDefault();
    } else if (key === 'm') {
      const next = !deps.state.settings.audioEnabled;
      deps.actions.setAudioEnabled(next);
      effects.toast({ icon: next ? '🔊' : '🔇', body: next ? 'Audio on' : 'Audio muted' });
      e.preventDefault();
    }
  });

  // First-run welcome: brand-new saves get the help panel once.
  if (deps.state.stats.playTimeSec < 5) {
    panels.open('help');
  }
}
