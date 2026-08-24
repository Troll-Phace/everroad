/**
 * Trophies panel: achievement wall. The grid is built once and cached; unlock
 * states are patched in place when 'achievement' events fire, so opening the
 * panel with 100+ achievements stays cheap.
 */
import type { AchievementCategory, AchievementDef, UIDeps } from '../types';
import { formatNumber } from '../types';
import { el } from './dom';
import { CURRENCY_ICONS } from './icons';
import type { PanelDef } from './panels';

const CATEGORIES: Array<AchievementCategory | 'all'> = [
  'all',
  'distance',
  'wealth',
  'garage',
  'skill',
  'explorer',
  'dedication',
  'prestige',
  'secret',
];

const CATEGORY_LABELS: Record<AchievementCategory | 'all', string> = {
  all: 'All',
  distance: 'Distance',
  wealth: 'Wealth',
  garage: 'Garage',
  skill: 'Skill',
  explorer: 'Explorer',
  dedication: 'Dedication',
  prestige: 'Prestige',
  secret: 'Secrets',
};

export function trophiesPanel(deps: UIDeps): PanelDef {
  const { state, catalogs, bus } = deps;

  // ---- cached grid ---------------------------------------------------------
  let grid: HTMLElement | null = null;
  const cards = new Map<string, HTMLElement>();
  let activeFilter: AchievementCategory | 'all' = 'all';

  function rewardText(def: AchievementDef): string {
    if (!def.reward) return '';
    return Object.entries(def.reward)
      .filter(([, v]) => (v ?? 0) > 0)
      .map(([k, v]) => `+${formatNumber(v!)} ${CURRENCY_ICONS[k as keyof typeof CURRENCY_ICONS]}`)
      .join('  ');
  }

  function applyUnlockState(def: AchievementDef, card: HTMLElement): void {
    const unlocked = state.achievements.includes(def.id);
    card.classList.toggle('is-unlocked', unlocked);
    card.classList.toggle('is-locked', !unlocked);
    const name = card.querySelector<HTMLElement>('.ach-name')!;
    const desc = card.querySelector<HTMLElement>('.ach-desc')!;
    const icon = card.querySelector<HTMLElement>('.ach-icon')!;
    if (!unlocked && def.secret) {
      name.textContent = '???';
      desc.textContent = 'A secret waits down the road.';
      icon.textContent = '❔';
    } else {
      name.textContent = def.name;
      desc.textContent = def.description;
      icon.textContent = def.icon;
    }
  }

  function buildGrid(): HTMLElement {
    const g = el('div', 'ach-grid');
    for (const def of catalogs.achievements) {
      const card = el('div', 'ach-card');
      card.dataset.category = def.category;
      const icon = el('div', 'ach-icon');
      const body = el('div', 'ach-body');
      const name = el('div', 'ach-name');
      const desc = el('div', 'ach-desc');
      body.append(name, desc);
      const reward = rewardText(def);
      if (reward) body.append(el('div', 'ach-reward', reward));
      card.append(icon, body);
      applyUnlockState(def, card);
      cards.set(def.id, card);
      g.append(card);
    }
    return g;
  }

  // Patch unlock states live, even while the panel is closed (cheap).
  bus.on('achievement', (p) => {
    for (const def of p.defs) {
      const card = cards.get(def.id);
      if (card) applyUnlockState(def, card);
    }
  });

  function applyFilter(): void {
    if (!grid) return;
    for (const card of cards.values()) {
      const show = activeFilter === 'all' || card.dataset.category === activeFilter;
      card.classList.toggle('hidden', !show);
    }
  }

  return {
    id: 'trophies',
    title: 'Trophies',
    key: 'T',
    render(content) {
      if (!grid) grid = buildGrid();

      // Header progress
      const total = catalogs.achievements.length;
      const progressWrap = el('div', 'ach-progress');
      const progressLabel = el('div', 'ach-progress-label mono');
      const track = el('div', 'progress-track');
      const fill = el('div', 'progress-fill');
      track.append(fill);
      progressWrap.append(progressLabel, track);
      content.append(progressWrap);

      // Category chips
      const chips = el('div', 'chip-row');
      const chipEls = new Map<string, HTMLElement>();
      for (const cat of CATEGORIES) {
        const chip = el('button', 'chip', CATEGORY_LABELS[cat]);
        chip.classList.toggle('is-active', cat === activeFilter);
        chip.addEventListener('click', () => {
          activeFilter = cat;
          for (const [c, node] of chipEls) node.classList.toggle('is-active', c === cat);
          applyFilter();
        });
        chipEls.set(cat, chip);
        chips.append(chip);
      }
      content.append(chips);

      applyFilter();
      content.append(grid);

      const update = (): void => {
        const n = state.achievements.length;
        progressLabel.textContent = `${n} / ${total} unlocked`;
        fill.style.width = `${total > 0 ? (n / total) * 100 : 0}%`;
      };
      update();
      return update;
    },
  };
}
