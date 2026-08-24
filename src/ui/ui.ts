/**
 * EverRoad UI module entry point.
 *
 * Owns everything inside #ui-root: corner HUD, center panels, toasts,
 * banners and modals. All mutations flow through deps.actions; state and
 * runtime are read live every frame.
 */
import './ui.css';
import type { AppMode, UIDeps } from '../types';
import { initEffects } from './effects';
import { initHUD } from './hud';
import { initMainMenu } from './mainMenu';
import { PanelManager } from './panels';
import { garagePanel } from './panelGarage';
import { helpPanel } from './panelHelp';
import { prestigePanel } from './panelPrestige';
import { settingsPanel } from './panelSettings';
import { trophiesPanel } from './panelTrophies';
import { upgradesPanel } from './panelUpgrades';
import { UPDATE_PANEL_ID, updatePanel } from './panelUpdate';
import { WHATS_NEW_PANEL_ID, whatsNewPanel } from './panelWhatsNew';
import { checkOnLaunch } from './update';
import { createModeTransition } from './transition';

export function initUI(deps: UIDeps): void {
  const root = document.getElementById('ui-root');
  if (!root) {
    console.error('[ui] #ui-root not found; UI not initialized');
    return;
  }

  const transition = createModeTransition();

  const effects = initEffects(deps, root);
  initHUD(deps, root);

  // Built before the menu, so `openSettings` below closes over a `panels` that
  // already exists rather than one still in its temporal dead zone. Mount order
  // no longer decides what paints on top: `.panel-layer` carries an explicit
  // z-index, so Settings opens over the menu however the two are appended.
  const panels = new PanelManager(deps, root);
  panels.register(garagePanel(deps));
  panels.register(upgradesPanel(deps));
  panels.register(trophiesPanel(deps));
  panels.register(prestigePanel(deps, panels));
  panels.register(settingsPanel(deps, panels, effects, transition));
  panels.register(helpPanel());
  panels.register(whatsNewPanel());
  panels.register(updatePanel());

  const menu = initMainMenu(deps, root, {
    transition,
    openSettings: () => panels.open('settings'),
    openWhatsNew: () => panels.open(WHATS_NEW_PANEL_ID),
    openUpdate: () => panels.open(UPDATE_PANEL_ID),
  });

  // The one network request EverRoad makes, and only in the desktop build: ask
  // the release feed whether anything newer exists. Fired once, here, on the
  // way up — the main process never checks on its own, so the preference in
  // Settings is the whole story (src/ui/update.ts).
  checkOnLaunch();

  // ---- keyboard -----------------------------------------------------------
  const keyToPanel: Record<string, string> = {
    g: 'garage',
    u: 'upgrades',
    t: 'trophies',
    p: 'prestige',
    h: 'help',
  };

  window.addEventListener('keydown', (e) => {
    // Held keys auto-repeat; only the initial press should toggle anything.
    if (e.repeat) return;
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
      // The panel hotkeys are gameplay furniture; on the menu they open panels
      // over a title screen that has no game to talk about.
      if (deps.runtime.appMode !== 'playing' || transition.busy) return;
      panels.toggle(keyToPanel[key]);
      e.preventDefault();
    } else if (key === 'escape') {
      // Unlike the panel hotkeys, Esc stays live on the menu — the footer
      // advertises it as the way into Settings. It does not stay live *during*
      // a mode fade: the player is already committed to a screen change, and
      // opening Settings here landed them in gameplay with the card still up.
      if (transition.busy) return;
      if (panels.current !== null) panels.close();
      else panels.open('settings');
      e.preventDefault();
    } else if (key === 'n') {
      // Live on the menu as well as in gameplay, like Esc and M: the patch
      // notes describe the build, not the journey, and the menu's own corner
      // button opens the same card. Still stands down during a mode fade.
      if (transition.busy) return;
      panels.toggle(WHATS_NEW_PANEL_ID);
      e.preventDefault();
    } else if (key === 'm') {
      // Also live on the menu, where the footer advertises it. Its toast is
      // player-initiated feedback, so it shows in either mode — the toast stack
      // is only hidden from *game* events, which are gated in effects.ts.
      const next = !deps.state.settings.audioEnabled;
      deps.actions.setAudioEnabled(next);
      effects.toast({ icon: next ? '🔊' : '🔇', body: next ? 'Audio on' : 'Audio muted' });
      e.preventDefault();
    }
  });

  // ---- app mode -----------------------------------------------------------
  // The menu shows over live attract footage. The HUD and the banner are
  // gameplay furniture, hidden in CSS off body[data-appmode]; game-event toasts
  // are gated at their source in effects.ts instead, so the stack itself stays
  // available for the menu's own feedback.
  let firstRunHelpShown = false;

  function applyMode(mode: AppMode): void {
    document.body.dataset.appmode = mode;
    menu.setMode(mode);
    // A panel belongs to the screen it was opened on, in both directions.
    // Quit-to-menu closes Settings itself, but any other panel left open must
    // not survive the change — and going the other way, Esc on the menu then
    // Enter on a button behind the card dropped the player into gameplay with
    // the settings panel still sitting over the road.
    panels.close();
    if (mode === 'menu') {
      // Toasts, the biome banner and the offline-summary overlay are gameplay
      // furniture too. The overlay in particular has no dismissal beyond its
      // own button, so quitting with it up parked it over the title screen.
      effects.clearTransient();
      return;
    }
    // First-run welcome: a brand-new save gets the help panel once, on its
    // first transition into play rather than on top of the main menu.
    if (!firstRunHelpShown && deps.state.stats.playTimeSec < 5) {
      firstRunHelpShown = true;
      panels.open('help');
    }
  }

  deps.bus.on('appModeChange', (p) => applyMode(p.mode));
  // Read the live value too, so the initial menu shows even if the engine's
  // first emit landed before this subscription.
  applyMode(deps.runtime.appMode);
}
