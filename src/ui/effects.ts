/**
 * Event-driven flourishes: toasts, biome banners, the offline-summary modal
 * and the prestige flash. All subscribe to the game event bus.
 */
import type { UIDeps } from '../types';
import { formatDuration, formatNumber } from '../types';
import { el } from './dom';
import { CURRENCY_ICONS } from './icons';

interface ToastRequest {
  icon?: string;
  title?: string;
  body: string;
}

const TOAST_MAX_VISIBLE = 3;
const TOAST_LIFETIME_MS = 4500;

/** How long a biome banner stays up before it fades itself out. */
const BANNER_LIFETIME_MS = 2600;

/** Ties the offline modal's card to its own heading for `aria-labelledby`. */
const OFFLINE_TITLE_ID = 'offline-summary-title';

export interface Effects {
  /**
   * Raise a toast for UI-initiated feedback — the mute key, "save code
   * copied", "save imported". These are answers to something the player just
   * did, so they show in any app mode. Toasts raised by *game* events go
   * through the gated path inside this module instead.
   */
  toast(req: ToastRequest): void;
  /**
   * Tear down everything transient. Called when play ends: the offline-summary
   * overlay, any live toast and the biome banner are all gameplay furniture and
   * must not outlive the session that raised them, or they sit over the main
   * menu (and, in the modal's case, return on the next Continue, since nothing
   * else ever removes it).
   */
  clearTransient(): void;
}

export function initEffects(deps: UIDeps, root: HTMLElement): Effects {
  const { bus } = deps;

  // ---- toast stack (top-center) -------------------------------------------
  const stack = el('div', 'toast-stack');
  root.append(stack);
  const queue: ToastRequest[] = [];

  function showNext(): void {
    if (queue.length === 0 || stack.childElementCount >= TOAST_MAX_VISIBLE) return;
    const req = queue.shift()!;
    const t = el('div', 'toast panel-glass');
    if (req.icon) t.append(el('span', 'toast-icon', req.icon));
    const txt = el('div', 'toast-text');
    if (req.title) txt.append(el('div', 'toast-title', req.title));
    txt.append(el('div', 'toast-body', req.body));
    t.append(txt);
    stack.append(t);
    window.setTimeout(() => {
      t.classList.add('toast-out');
      window.setTimeout(() => {
        t.remove();
        showNext();
      }, 300);
    }, TOAST_LIFETIME_MS);
  }

  function toast(req: ToastRequest): void {
    queue.push(req);
    showNext();
  }

  /**
   * Toasts raised by the game rather than by the player's own UI action.
   *
   * Attract mode runs the real world behind the title screen — the demo car
   * really does collect relics and cross biomes — so these events keep firing
   * while the menu is up. Hiding the stack in CSS was not enough: a toast has a
   * 4.5s life, so one raised on the menu was still on screen inside the journey
   * the player started next, congratulating them for a relic the attract car
   * found. A toast that is never raised cannot leak.
   */
  function gameToast(req: ToastRequest): void {
    if (deps.runtime.appMode !== 'playing') return;
    toast(req);
  }

  bus.on('toast', (p) => gameToast({ icon: p.icon, body: p.text }));

  bus.on('achievement', (p) => {
    for (const def of p.defs) {
      let body = def.name;
      if (def.reward) {
        const parts = Object.entries(def.reward)
          .filter(([, v]) => (v ?? 0) > 0)
          .map(
            ([k, v]) => `+${formatNumber(v!)} ${CURRENCY_ICONS[k as keyof typeof CURRENCY_ICONS]}`,
          );
        if (parts.length > 0) body += `  ·  ${parts.join('  ')}`;
      }
      gameToast({ icon: def.icon, title: 'Achievement unlocked!', body });
    }
  });

  bus.on('pickup', (p) => {
    if (p.kind === 'relic') gameToast({ icon: '🍁', body: 'Relic found!' });
  });

  // ---- biome banner (Zelda-style area title) ------------------------------
  const banner = el('div', 'biome-banner hidden');
  const bannerName = el('div', 'biome-banner-name');
  const bannerRule = el('div', 'biome-banner-rule');
  banner.append(bannerName, bannerRule);
  root.append(banner);
  let bannerTimer = 0;

  bus.on('biomeChange', (p) => {
    // Same leak as gameToast: the attract drive crosses biomes, and a banner
    // raised on the menu is still up 2.6s later inside the new journey.
    if (deps.runtime.appMode !== 'playing') return;
    bannerName.textContent = p.name;
    banner.classList.remove('hidden', 'biome-banner-show');
    void banner.offsetWidth;
    banner.classList.add('biome-banner-show');
    window.clearTimeout(bannerTimer);
    bannerTimer = window.setTimeout(hideBanner, BANNER_LIFETIME_MS);
  });

  function hideBanner(): void {
    window.clearTimeout(bannerTimer);
    bannerTimer = 0;
    banner.classList.add('hidden');
    banner.classList.remove('biome-banner-show');
  }

  // ---- offline summary modal ----------------------------------------------
  // Singleton: a later 'offlineSummary' replaces the modal rather than
  // stacking a second undismissed overlay on top of it. `closeOffline` is the
  // live modal's own teardown, so whoever tears it down also detaches its key
  // listener and hands focus back.
  let offlineOverlay: HTMLElement | null = null;
  let closeOffline: (() => void) | null = null;

  bus.on('offlineSummary', (p) => {
    closeOffline?.();
    const overlay = el('div', 'modal-overlay');
    offlineOverlay = overlay;
    const card = el('div', 'panel-glass modal-card panel-in');
    // It behaves as a modal dialog, so it announces itself as one and points
    // at its own title.
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-labelledby', OFFLINE_TITLE_ID);
    card.append(el('div', 'modal-kicker', 'Welcome back'));
    const title = el('h2', 'modal-title', 'While you were away…');
    title.id = OFFLINE_TITLE_ID;
    card.append(title);
    const rows = el('div', 'offline-rows');
    const timeRow = el('div', 'offline-row');
    timeRow.append(el('span', 'offline-icon', '⏱'), el('span', 'mono', formatDuration(p.seconds)));
    const arrow = el('div', 'offline-arrow', '→');
    const coinRow = el('div', 'offline-row');
    coinRow.append(
      el('span', 'offline-icon', '🪙'),
      el('span', 'mono', `+${formatNumber(p.coins)}`),
    );
    rows.append(timeRow, arrow, coinRow);
    card.append(rows);
    card.append(el('p', 'modal-sub', 'The road kept rolling without you.'));
    const btn = el('button', 'btn btn-accent', 'Back on the road');

    // Where focus was before the modal stole it, so dismissing puts it back
    // rather than dropping the player on <body> with nothing tabbable near by.
    const returnFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    // Declared as hoisted functions, not consts: they reference each other, and
    // a const pair here would be one reordering away from a TDZ error.
    function dismiss(): void {
      window.removeEventListener('keydown', onKey, true);
      overlay.remove();
      if (offlineOverlay === overlay) offlineOverlay = null;
      if (closeOffline === dismiss) closeOffline = null;
      if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    }

    function onKey(e: KeyboardEvent): void {
      if (e.key !== 'Escape' || e.repeat) return;
      e.preventDefault();
      // Capture phase plus stopPropagation, so the global Esc handler in ui.ts
      // does not also open Settings behind the modal we just dismissed.
      e.stopPropagation();
      dismiss();
    }

    closeOffline = dismiss;
    btn.addEventListener('click', dismiss);
    card.append(btn);
    overlay.append(card);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) dismiss();
    });
    window.addEventListener('keydown', onKey, true);
    root.append(overlay);
    btn.focus({ preventScroll: true });
  });

  // ---- prestige celebration -----------------------------------------------
  const flash = el('div', 'prestige-flash hidden');
  root.append(flash);
  bus.on('prestige', (p) => {
    flash.classList.remove('hidden', 'prestige-flash-run');
    void flash.offsetWidth;
    flash.classList.add('prestige-flash-run');
    window.setTimeout(() => flash.classList.add('hidden'), 1800);
    gameToast({
      icon: '🌅',
      title: 'New Journey begins',
      body: `+${formatNumber(p.tokensGained)} 🌅 Horizon Tokens`,
    });
  });

  function clearTransient(): void {
    closeOffline?.();
    // Belt and braces: a modal built before `closeOffline` existed, or one
    // whose teardown already ran, still leaves nothing attached.
    offlineOverlay?.remove();
    offlineOverlay = null;
    closeOffline = null;
    // Any toast still on screen or still queued belongs to the session that
    // ended. The pending lifetime timers are left to expire against detached
    // nodes, which is a no-op — the queue is empty by then.
    queue.length = 0;
    stack.replaceChildren();
    hideBanner();
  }

  return { toast, clearTransient };
}
