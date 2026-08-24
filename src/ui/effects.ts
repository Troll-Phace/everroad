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

export interface Effects {
  toast(req: ToastRequest): void;
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

  bus.on('toast', (p) => toast({ icon: p.icon, body: p.text }));

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
      toast({ icon: def.icon, title: 'Achievement unlocked!', body });
    }
  });

  bus.on('pickup', (p) => {
    if (p.kind === 'relic') toast({ icon: '🍁', body: 'Relic found!' });
  });

  // ---- biome banner (Zelda-style area title) ------------------------------
  const banner = el('div', 'biome-banner hidden');
  const bannerName = el('div', 'biome-banner-name');
  const bannerRule = el('div', 'biome-banner-rule');
  banner.append(bannerName, bannerRule);
  root.append(banner);
  let bannerTimer = 0;

  bus.on('biomeChange', (p) => {
    bannerName.textContent = p.name;
    banner.classList.remove('hidden', 'biome-banner-show');
    void banner.offsetWidth;
    banner.classList.add('biome-banner-show');
    window.clearTimeout(bannerTimer);
    bannerTimer = window.setTimeout(() => {
      banner.classList.add('hidden');
      banner.classList.remove('biome-banner-show');
    }, 2600);
  });

  // ---- offline summary modal ----------------------------------------------
  // Singleton: a later 'offlineSummary' replaces the modal rather than
  // stacking a second undismissed overlay on top of it.
  let offlineOverlay: HTMLElement | null = null;
  bus.on('offlineSummary', (p) => {
    offlineOverlay?.remove();
    const overlay = el('div', 'modal-overlay');
    offlineOverlay = overlay;
    const card = el('div', 'panel-glass modal-card panel-in');
    card.append(el('div', 'modal-kicker', 'Welcome back'));
    card.append(el('h2', 'modal-title', 'While you were away…'));
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
    btn.addEventListener('click', () => overlay.remove());
    card.append(btn);
    overlay.append(card);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
    root.append(overlay);
  });

  // ---- prestige celebration -----------------------------------------------
  const flash = el('div', 'prestige-flash hidden');
  root.append(flash);
  bus.on('prestige', (p) => {
    flash.classList.remove('hidden', 'prestige-flash-run');
    void flash.offsetWidth;
    flash.classList.add('prestige-flash-run');
    window.setTimeout(() => flash.classList.add('hidden'), 1800);
    toast({
      icon: '🌅',
      title: 'New Journey begins',
      body: `+${formatNumber(p.tokensGained)} 🌅 Horizon Tokens`,
    });
  });

  return { toast };
}
