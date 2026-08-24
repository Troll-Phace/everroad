/**
 * Garage panel: car catalog grid with buy/select interactions.
 */
import type { CarDef, UIDeps } from '../types';
import { formatNumber } from '../types';
import { el } from './dom';
import { CURRENCY_ICONS } from './icons';
import type { PanelDef } from './panels';
import type { PanelManager } from './panels';

export function garagePanel(deps: UIDeps, manager: PanelManager): PanelDef {
  const { state, catalogs, actions } = deps;

  function canAfford(car: CarDef): boolean {
    return state.currencies[car.costCurrency] >= car.cost;
  }

  function buildCard(car: CarDef): { node: HTMLElement; update: () => void } {
    const owned = state.ownedCars.includes(car.id);
    const selected = state.currentCarId === car.id;

    const card = el('div', 'car-card');
    if (owned) card.classList.add('is-owned');
    if (selected) card.classList.add('is-selected');

    // Swatch pair
    const swatches = el('div', 'car-swatches');
    const body = el('span', 'car-swatch');
    body.style.background = car.style.bodyColor;
    const accent = el('span', 'car-swatch');
    accent.style.background = car.style.accentColor;
    swatches.append(body, accent);

    const head = el('div', 'car-head');
    const name = el('div', 'car-name', car.name);
    const stars = el('div', 'car-tier', '★'.repeat(car.tier + 1));
    head.append(name, stars);

    const stats = el('div', 'car-stats');
    const speed = el('span', 'car-stat');
    speed.append(el('span', 'mono', String(car.baseSpeed)), document.createTextNode(' mph'));
    const mult = el('span', 'car-stat');
    mult.append(document.createTextNode('coins ×'), el('span', 'mono', String(car.coinMult)));
    stats.append(speed, mult);

    const flavor = el('div', 'car-flavor', car.description);

    const footer = el('div', 'car-footer');
    let update: () => void = () => {};

    if (selected) {
      footer.append(el('span', 'car-status car-status-selected', 'Driving'));
    } else if (owned) {
      const btn = el('button', 'btn btn-ghost', 'Select');
      btn.addEventListener('click', () => {
        actions.selectCar(car.id);
        manager.refresh();
      });
      footer.append(btn);
    } else {
      const buy = el('button', 'btn btn-accent');
      buy.append(
        document.createTextNode('Buy '),
        el('span', 'mono', formatNumber(car.cost)),
        document.createTextNode(` ${CURRENCY_ICONS[car.costCurrency]}`),
      );
      buy.addEventListener('click', () => {
        if (actions.buyCar(car.id)) manager.refresh();
      });
      footer.append(buy);
      update = () => {
        const ok = canAfford(car);
        buy.disabled = !ok;
        card.classList.toggle('is-locked', !ok);
      };
      update();
    }

    card.append(swatches, head, stats, flavor, footer);
    return { node: card, update };
  }

  return {
    id: 'garage',
    title: 'Garage',
    key: 'G',
    render(content) {
      const grid = el('div', 'car-grid');
      const sorted = [...catalogs.cars].sort((a, b) => a.tier - b.tier || a.cost - b.cost);
      const updaters: Array<() => void> = [];
      for (const car of sorted) {
        const { node, update } = buildCard(car);
        grid.append(node);
        updaters.push(update);
      }
      content.append(grid);
      return () => updaters.forEach((u) => u());
    },
  };
}
