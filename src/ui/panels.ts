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

/**
 * What counts as tabbable inside a panel card, for the focus trap. Matches the
 * controls the panels actually build — buttons, the save-code textarea, the
 * settings sliders and selects — plus anything that opted into the tab order.
 */
const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/** Ties a card to its own heading for `aria-labelledby`. One panel is open at a time. */
const PANEL_TITLE_ID = 'panel-card-title';

export class PanelManager {
  current: string | null = null;

  private layer: HTMLElement;
  private panels = new Map<string, PanelDef>();
  private card: HTMLElement | null = null;
  private content: HTMLElement | null = null;
  private updater: (() => void) | null = null;
  private updateTimer = 0;
  /** Where focus was when the panel opened, so closing hands it back. */
  private returnFocus: HTMLElement | null = null;

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
    // A panel is a modal dialog: while one is up, Tab cycles inside it instead
    // of walking out into whatever sits behind (the main menu's action slabs,
    // most visibly). The listener sits on the layer because focus is always
    // inside the card, so the keydown bubbles through here.
    this.layer.addEventListener('keydown', (e) => this.trapTab(e));
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

    this.returnFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const card = el('div', 'panel-glass panel-card panel-in');
    // Focusable so opening the panel can move focus into it. Without this the
    // player's focus stayed on the control behind the card — on the menu, that
    // meant Enter still fired Continue through an open Settings panel.
    card.tabIndex = -1;
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-labelledby', PANEL_TITLE_ID);
    const header = el('div', 'panel-header');
    const title = el('h2', 'panel-title', def.title);
    title.id = PANEL_TITLE_ID;
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
    card.focus({ preventScroll: true });
    this.deps.bus.emit('uiPanelChange', { panel: id });
  }

  close(): void {
    if (this.current === null) return;
    const returnFocus = this.returnFocus;
    this.returnFocus = null;
    this.teardown();
    this.layer.classList.add('hidden');
    this.current = null;
    delete document.body.dataset.panel;
    // Emit first: listeners un-inert what the panel was covering, and focus
    // cannot land on an inert element.
    this.deps.bus.emit('uiPanelChange', { panel: null });
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
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

  /** Wrap Tab / Shift+Tab around the open card's own controls. */
  private trapTab(e: KeyboardEvent): void {
    if (e.key !== 'Tab' || this.card === null) return;
    const card = this.card;
    // `offsetParent` is null for a `display: none` control (locked rows, the
    // gameplay-only quit block), which must not be a tab stop.
    const items = Array.from(card.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (node) => node.offsetParent !== null,
    );
    if (items.length === 0) {
      card.focus({ preventScroll: true });
      e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === card)) {
      last.focus();
      e.preventDefault();
    } else if (!e.shiftKey && active === last) {
      first.focus();
      e.preventDefault();
    }
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
