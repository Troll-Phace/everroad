/**
 * Panel manager: one center-screen glass card at a time, toggled by hotkeys.
 * Panels register a render function; ones with live numbers also register a
 * cheap update() that runs on an interval while open.
 */
import type { UIDeps } from '../types';
import { el } from './dom';

export interface PanelDef {
  id: string;
  title: string;
  /** Hotkey hint shown in the header, e.g. 'G'. */
  key: string;
  /**
   * Build the panel's content into `content`. Returns an optional cheap
   * updater invoked ~4x/sec while the panel stays open (affordability etc.).
   */
  render(content: HTMLElement): (() => void) | void;
}

const UPDATE_INTERVAL_MS = 250;

export class PanelManager {
  current: string | null = null;

  private layer: HTMLElement;
  private panels = new Map<string, PanelDef>();
  private card: HTMLElement | null = null;
  private content: HTMLElement | null = null;
  private updater: (() => void) | null = null;
  private updateTimer = 0;

  constructor(
    private deps: UIDeps,
    root: HTMLElement,
  ) {
    this.layer = el('div', 'panel-layer hidden');
    root.append(this.layer);
    // Click on the dimmed backdrop closes the panel.
    this.layer.addEventListener('click', (e) => {
      if (e.target === this.layer) this.close();
    });
    // Purchases / car swaps re-render whatever panel is open so costs,
    // levels and ownership states stay honest.
    deps.bus.on('purchase', () => this.refresh());
    deps.bus.on('carSelected', () => this.refresh());
  }

  register(def: PanelDef): void {
    this.panels.set(def.id, def);
  }

  /** Open `id`, or close it if it is already the open panel. */
  toggle(id: string): void {
    if (this.current === id) this.close();
    else this.open(id);
  }

  open(id: string): void {
    const def = this.panels.get(id);
    if (!def) return;
    this.teardown();

    const card = el('div', 'panel-glass panel-card panel-in');
    const header = el('div', 'panel-header');
    const title = el('h2', 'panel-title', def.title);
    const hints = el('div', 'panel-hints');
    if (def.key !== 'Esc') hints.append(el('span', 'key-hint', def.key));
    hints.append(el('span', 'key-hint', 'Esc'));
    header.append(title, hints);
    const content = el('div', 'panel-content');
    card.append(header, content);

    this.updater = def.render(content) ?? null;
    if (this.updater) {
      this.updater();
      this.updateTimer = window.setInterval(this.updater, UPDATE_INTERVAL_MS);
    }

    this.layer.append(card);
    this.layer.classList.remove('hidden');
    this.card = card;
    this.content = content;
    this.current = id;
    document.body.dataset.panel = id;
    this.deps.bus.emit('uiPanelChange', { panel: id });
  }

  close(): void {
    if (this.current === null) return;
    this.teardown();
    this.layer.classList.add('hidden');
    this.current = null;
    delete document.body.dataset.panel;
    this.deps.bus.emit('uiPanelChange', { panel: null });
  }

  /** Re-render the open panel in place, preserving scroll position. */
  refresh(): void {
    if (this.current === null || this.content === null) return;
    const def = this.panels.get(this.current);
    if (!def) return;
    const scroll = this.content.scrollTop;
    this.stopUpdates();
    this.content.replaceChildren();
    this.updater = def.render(this.content) ?? null;
    if (this.updater) {
      this.updater();
      this.updateTimer = window.setInterval(this.updater, UPDATE_INTERVAL_MS);
    }
    this.content.scrollTop = scroll;
  }

  private stopUpdates(): void {
    if (this.updateTimer !== 0) {
      window.clearInterval(this.updateTimer);
      this.updateTimer = 0;
    }
    this.updater = null;
  }

  private teardown(): void {
    this.stopUpdates();
    this.card?.remove();
    this.card = null;
    this.content = null;
  }
}
