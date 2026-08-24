/**
 * Main menu — the title screen that sits over live attract-mode footage.
 *
 * Visible only while `runtime.appMode === 'menu'`. Everything behind it is the
 * real world running as cinematic footage, so there is no fixed background to
 * design against: legibility comes from the scrim, the glass slabs the buttons
 * sit on, and text shadow, never from assuming a dark sky.
 *
 * The menu owns no game state. Continue / New Journey go through
 * `UIActions.startGame` behind the mode fade; Settings and What's New hand off
 * to the panel manager via the `openSettings` / `openWhatsNew` callbacks so
 * this module stays panel-agnostic.
 */
import type { AppMode, SaveSummary, UIDeps } from '../types';
import { formatDuration, formatMiles, formatNumber } from '../types';
import { armConfirm } from './confirm';
import { createBuildBadge } from './buildBadge';
import { el, textUpdater } from './dom';
import { CURRENCY_ICONS } from './icons';
import { hasUnseenRelease, markSeen } from './panelWhatsNew';
import type { ModeTransition } from './transition';

/**
 * How often the "last driven …" line is recomputed while the menu is up. The
 * value is a coarse relative time, so twice a minute is plenty.
 */
const RELATIVE_TIME_REFRESH_MS = 30_000;

/**
 * Delay before focus lands on the primary button at boot, so it happens after
 * the loading screen has begun lifting (style.css: 1.2s fade starting ~250ms
 * in) rather than under it.
 */
const BOOT_FOCUS_DELAY_MS = 700;

/** Delay before focus lands when returning from gameplay — the cover already hides this. */
const RETURN_FOCUS_DELAY_MS = 60;

/** How long the staggered boot entrance runs before the animation classes are dropped. */
const BOOT_ANIM_MS = 2000;

/** Below this age the relative time reads as "just now" instead of "3s ago". */
const JUST_NOW_SEC = 45;

export interface MainMenu {
  /** Show or hide the menu for the app mode. Safe to call with the same mode twice. */
  setMode(mode: AppMode): void;
}

export interface MainMenuOptions {
  transition: ModeTransition;
  /** Opens the settings panel over the menu. */
  openSettings(): void;
  /** Opens the What's New panel over the menu. */
  openWhatsNew(): void;
}

interface MenuButton {
  btn: HTMLButtonElement;
  label: HTMLElement;
  sub: HTMLElement;
  meta: HTMLElement;
}

export function initMainMenu(deps: UIDeps, root: HTMLElement, opts: MainMenuOptions): MainMenu {
  const { actions } = deps;
  const { transition } = opts;

  // ---- structure ----------------------------------------------------------
  const layer = el('div', 'main-menu hidden menu-boot');
  const scrim = el('div', 'menu-scrim');
  const inner = el('div', 'menu-inner');

  const brand = el('div', 'menu-brand');
  brand.append(el('h1', 'menu-wordmark', 'EVERROAD'));
  brand.append(el('p', 'menu-tagline', 'the road goes on forever'));

  const actionList = el('div', 'menu-actions');
  actionList.setAttribute('role', 'group');
  actionList.setAttribute('aria-label', 'Main menu');

  function menuButton(label: string): MenuButton {
    const btn = el('button', 'btn panel-glass menu-btn');
    btn.type = 'button';
    const rail = el('span', 'menu-btn-rail');
    rail.setAttribute('aria-hidden', 'true');
    const body = el('span', 'menu-btn-body');
    const labelEl = el('span', 'menu-btn-label', label);
    const subEl = el('span', 'menu-btn-sub');
    const metaEl = el('span', 'menu-btn-meta mono');
    body.append(labelEl, subEl, metaEl);
    btn.append(rail, body);
    actionList.append(btn);
    return { btn, label: labelEl, sub: subEl, meta: metaEl };
  }

  const cont = menuButton('Continue');
  const fresh = menuButton('New Journey');
  const settings = menuButton('Settings');
  settings.sub.textContent = 'Audio, graphics and your save code';

  const footer = el(
    'div',
    'menu-footer',
    '↑ ↓ choose  ·  Enter start  ·  Esc settings  ·  N what\u2019s new  ·  M mute',
  );

  // ---- corner furniture ---------------------------------------------------
  // Both of these live inside `inner`, not on `layer`, so the `inert` attribute
  // set on `inner` while a panel is open covers them with the action column.
  // Anything appended to `layer` instead would stay keyboard-live behind an
  // open card — the PR #46 defect. They are `position: fixed` in CSS because
  // `inner` is only the left-hand column and these belong to the frame.
  const whatsNew = el('button', 'btn panel-glass menu-corner-btn');
  whatsNew.type = 'button';
  whatsNew.append(el('span', 'menu-corner-label', 'What\u2019s New'));
  const newDot = el('span', 'menu-corner-dot hidden');
  newDot.setAttribute('aria-hidden', 'true');
  whatsNew.append(newDot);

  const build = createBuildBadge('menu-build mono');

  inner.append(brand, actionList, footer, whatsNew, build);
  layer.append(scrim, inner);
  root.append(layer);

  // The Up/Down cycle, deliberately only the three centre slabs. The corner
  // What's New button is Tab-reachable but is not part of the column, and
  // arrowing into it would step the focus out of the frame's centre.
  const buttons = [cont.btn, fresh.btn, settings.btn];

  // ---- live text ----------------------------------------------------------
  const setContSub = textUpdater(cont.sub);
  const setContMeta = textUpdater(cont.meta);
  const setFreshSub = textUpdater(fresh.sub);

  /** "2h 14m ago" / "just now" from an epoch-ms timestamp. */
  function relativeTime(epochMs: number): string {
    const sec = (Date.now() - epochMs) / 1000;
    return sec < JUST_NOW_SEC ? 'just now' : `${formatDuration(sec)} ago`;
  }

  /** One quiet line describing the stored journey. */
  function summaryLine(s: SaveSummary): string {
    const parts = [
      `${formatMiles(s.journeyMiles)} mi`,
      `${CURRENCY_ICONS.coins} ${formatNumber(s.coins)}`,
      s.carName,
    ];
    if (s.prestigeCount > 0) parts.push(`Journey ${s.prestigeCount + 1}`);
    return parts.join('  ·  ');
  }

  let summary: SaveSummary | null = null;

  // Declared before `refresh()`, which disarms it on every re-read. `begin` is
  // a hoisted function declaration, so this does not create the mirror problem.
  const freshConfirm = armConfirm(fresh.btn, {
    label: fresh.label,
    idle: 'New Journey',
    armed: 'Erase your journey? Click again',
    // Nothing to lose without a save: start on the first click.
    needsConfirm: () => actions.hasSave(),
    onConfirm: () => begin(() => actions.startGame('new')),
  });

  /** Re-read the save and rebuild both action buttons around it. */
  function refresh(): void {
    summary = actions.hasSave() ? actions.getSaveSummary() : null;
    const hasSave = summary !== null;

    // Continue stays visible when there is nothing to continue — a disabled
    // button with a reason beats a button that vanished.
    cont.btn.disabled = !hasSave;
    if (summary) {
      setContSub(summaryLine(summary));
      setContMeta(`last driven ${relativeTime(summary.lastSaveTime)}`);
    } else {
      setContSub('No journey yet');
      setContMeta('Start a new one below');
    }

    setFreshSub(
      hasSave ? 'Erases the journey above and starts over' : 'Take the first mile of the road',
    );
    freshConfirm.reset();

    // The primary action is whichever one the player most likely wants.
    cont.btn.classList.toggle('is-primary', hasSave);
    fresh.btn.classList.toggle('is-primary', !hasSave);

    // Purely an affordance: the dot says there is something unread, the button
    // says what it is. Nothing is communicated by the dot alone.
    newDot.classList.toggle('hidden', !hasUnseenRelease());
  }

  /** Only the relative time drifts while the menu sits open. */
  function refreshRelativeTime(): void {
    if (summary) setContMeta(`last driven ${relativeTime(summary.lastSaveTime)}`);
  }

  // ---- actions ------------------------------------------------------------
  /** Guarded entry into the fade: pointer clicks are blocked by the cover, keys are not. */
  function begin(swap: () => void): void {
    if (transition.busy) return;
    transition.run(swap);
  }

  cont.btn.addEventListener('click', () => {
    if (cont.btn.disabled) return;
    begin(() => actions.startGame('continue'));
  });

  settings.btn.addEventListener('click', () => {
    if (transition.busy) return;
    opts.openSettings();
  });

  // Same guarded hand-off as Settings: the panel manager owns the card, this
  // module only asks for it.
  whatsNew.addEventListener('click', () => {
    if (transition.busy) return;
    // The panel marks the build seen as it renders; clear the dot here too so
    // the affordance goes quiet on the click that answered it.
    markSeen();
    newDot.classList.add('hidden');
    opts.openWhatsNew();
  });

  // ---- keyboard -----------------------------------------------------------
  // Up/Down cycle the enabled buttons; Enter/Space are the button's own.
  window.addEventListener('keydown', (e) => {
    if (!visible || e.repeat) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    // A panel opened over the menu owns the keyboard while it is up.
    if (document.body.dataset.panel !== undefined) return;
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;

    const enabled = buttons.filter((b) => !b.disabled);
    if (enabled.length === 0) return;
    // Unchecked cast: `indexOf` only compares by identity, so a non-button
    // (or null) activeElement simply returns -1 and falls into the `at === -1`
    // branch below. Nothing is called on the value.
    const at = enabled.indexOf(document.activeElement as HTMLButtonElement);
    const step = e.key === 'ArrowDown' ? 1 : -1;
    const next = at === -1 ? 0 : (at + step + enabled.length) % enabled.length;
    enabled[next].focus();
    e.preventDefault();
  });

  // ---- panel occlusion ----------------------------------------------------
  /**
   * Take the menu column out of the tab order and off the hit-testing path
   * while a panel is open over it.
   *
   * `inert` is what actually does this. The CSS recede
   * (`body[data-appmode='menu'][data-panel] .menu-inner`) only fades the column
   * — and it fades the focus outline with it, so a focused button behind an
   * open panel became an invisible one. `pointer-events: none` on the column
   * does not help either: `.btn` sets `pointer-events: auto`, which
   * re-establishes each button as a hit target under a `none` ancestor. Only
   * the panel layer painting on top was stopping the mouse, and nothing at all
   * was stopping Enter from firing Continue through the card.
   */
  let inerted = false;

  function setInert(on: boolean): void {
    if (on === inerted) return;
    inerted = on;
    if (on) inner.setAttribute('inert', '');
    else inner.removeAttribute('inert');
  }

  // ---- visibility ---------------------------------------------------------
  let visible = false;
  let booted = false;
  let ticker = 0;
  let focusTimer = 0;

  function focusPrimary(delayMs: number): void {
    window.clearTimeout(focusTimer);
    focusTimer = window.setTimeout(() => {
      const target = buttons.find((b) => b.classList.contains('is-primary') && !b.disabled);
      (target ?? fresh.btn).focus({ preventScroll: true });
    }, delayMs);
  }

  function setMode(mode: AppMode): void {
    const show = mode === 'menu';
    if (show === visible) return;
    visible = show;
    layer.classList.toggle('hidden', !show);
    layer.setAttribute('aria-hidden', show ? 'false' : 'true');

    if (!show) {
      window.clearInterval(ticker);
      ticker = 0;
      window.clearTimeout(focusTimer);
      setInert(false);
      return;
    }

    // A panel may still be up as the menu comes back (quit-to-menu tears one
    // down a moment later); start from the live truth rather than assuming.
    setInert(document.body.dataset.panel !== undefined);
    refresh();
    ticker = window.setInterval(refreshRelativeTime, RELATIVE_TIME_REFRESH_MS);
    focusPrimary(booted ? RETURN_FOCUS_DELAY_MS : BOOT_FOCUS_DELAY_MS);
    if (!booted) {
      booted = true;
      // The staggered entrance is a one-time handoff from the loading screen;
      // later returns arrive from behind the fade cover and need no entrance.
      window.setTimeout(() => layer.classList.remove('menu-boot'), BOOT_ANIM_MS);
    }
  }

  deps.bus.on('uiPanelChange', (p) => {
    setInert(visible && p.panel !== null);
    // Import / reset from the settings panel can change the save out from
    // under the menu; re-read it whenever a panel closes.
    if (p.panel === null && visible) refresh();
  });

  return { setMode };
}
