/**
 * Upgrades panel: per-car part upgrades + the token-funded Horizon Shop.
 */
import type { UIDeps } from '../types';
import { formatNumber } from '../types';
import { el } from './dom';
import { CURRENCY_ICONS } from './icons';
import type { PanelDef, PanelManager } from './panels';

interface RowSpec {
  name: string;
  description: string;
  effectLabel: string;
  maxLevel: number;
  currencyIcon: string;
  getLevel(): number;
  getCost(): number;
  getBalance(): number;
  buy(): boolean;
}

export function upgradesPanel(deps: UIDeps, manager: PanelManager): PanelDef {
  const { state, catalogs, actions } = deps;

  function buildRow(spec: RowSpec): { node: HTMLElement; update: () => void } {
    const row = el('div', 'upgrade-row');
    const info = el('div', 'upgrade-info');
    const head = el('div', 'upgrade-head');
    head.append(el('span', 'upgrade-name', spec.name));
    const level = el('span', 'upgrade-level mono');
    head.append(level);
    info.append(head);
    info.append(el('div', 'upgrade-desc', spec.description));
    info.append(el('div', 'upgrade-effect', `${spec.effectLabel} / level`));

    const buy = el('button', 'btn btn-accent upgrade-buy');
    const costSpan = el('span', 'mono');
    buy.append(costSpan, document.createTextNode(` ${spec.currencyIcon}`));
    buy.addEventListener('click', () => {
      if (spec.buy()) manager.refresh();
    });

    row.append(info, buy);

    const update = (): void => {
      const lvl = spec.getLevel();
      level.textContent = `Lv ${lvl}/${spec.maxLevel}`;
      if (lvl >= spec.maxLevel) {
        buy.disabled = true;
        buy.replaceChildren(document.createTextNode('MAX'));
        row.classList.add('is-maxed');
      } else {
        const cost = spec.getCost();
        costSpan.textContent = formatNumber(cost);
        buy.disabled = spec.getBalance() < cost;
      }
    };
    update();
    return { node: row, update };
  }

  return {
    id: 'upgrades',
    title: 'Upgrades',
    key: 'U',
    render(content) {
      const updaters: Array<() => void> = [];
      const carId = state.currentCarId;
      const car = catalogs.cars.find((c) => c.id === carId);

      content.append(el('div', 'section-label', car ? `Parts — ${car.name}` : 'Parts'));
      const partList = el('div', 'upgrade-list');
      for (const def of catalogs.upgrades) {
        const { node, update } = buildRow({
          name: def.name,
          description: def.description,
          effectLabel: def.effectLabel,
          maxLevel: def.maxLevel,
          currencyIcon: CURRENCY_ICONS.coins,
          getLevel: () => state.upgrades[carId]?.[def.id] ?? 0,
          getCost: () => actions.getUpgradeCost(carId, def.id),
          getBalance: () => state.currencies.coins,
          buy: () => actions.buyUpgrade(carId, def.id),
        });
        partList.append(node);
        updaters.push(update);
      }
      content.append(partList);

      content.append(el('div', 'panel-divider'));
      content.append(el('div', 'section-label', `Horizon Shop ${CURRENCY_ICONS.tokens}`));

      const horizonUnlocked = state.stats.prestigeCount > 0 || state.currencies.tokens > 0;
      if (!horizonUnlocked) {
        content.append(
          el(
            'div',
            'horizon-teaser',
            'Complete a New Journey to earn Horizon Tokens and unlock permanent upgrades.',
          ),
        );
      } else {
        const globalList = el('div', 'upgrade-list');
        for (const def of catalogs.globalUpgrades) {
          const { node, update } = buildRow({
            name: def.name,
            description: def.description,
            effectLabel: def.effectLabel,
            maxLevel: def.maxLevel,
            currencyIcon: CURRENCY_ICONS.tokens,
            getLevel: () => state.globalUpgrades[def.id] ?? 0,
            getCost: () => actions.getGlobalUpgradeCost(def.id),
            getBalance: () => state.currencies.tokens,
            buy: () => actions.buyGlobalUpgrade(def.id),
          });
          globalList.append(node);
          updaters.push(update);
        }
        content.append(globalList);
      }

      return () => updaters.forEach((u) => u());
    },
  };
}
