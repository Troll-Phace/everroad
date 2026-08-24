/**
 * Keyboard input for driving. Panel/menu keys are handled by the UI module;
 * driving input is ignored while a panel is open (body.dataset.panel set).
 */

const HOLD_TIMEOUT = 4; // seconds after last steer input before autopilot resumes

export class Input {
  private keys = new Set<string>();
  /** Seconds since last driving input. */
  private sinceInput = Infinity;
  /**
   * False while the world is running as attract-mode footage behind the main
   * menu (docs/ARCHITECTURE.md §4.1). Disabled input reports neutral controls
   * *and* stops touching keydown at all, so the menu's own keyboard navigation
   * is neither recorded here nor preventDefault-ed out from under it.
   */
  private enabled = true;

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if (this.shouldIgnore(e)) return;
      this.keys.add(e.code);
      if (this.isDriveKey(e.code)) this.sinceInput = 0;
      // Don't let arrows or space scroll the page. shouldIgnore() has already
      // let through anything typed into a field or aimed at an open panel, so
      // Space is only swallowed while the game surface owns the keyboard.
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
    window.addEventListener('blur', () => this.keys.clear());
  }

  private shouldIgnore(e: KeyboardEvent): boolean {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return true;
    // A focused control owns its own keys. The offline-summary modal's button
    // is not a panel (it never sets body.dataset.panel), so without this the
    // Space preventDefault below would cancel its keyboard activation.
    if (t && (t.tagName === 'BUTTON' || t.isContentEditable)) return true;
    if (document.body.dataset.panel) return true;
    return false;
  }

  private isDriveKey(code: string): boolean {
    return (
      code === 'KeyW' ||
      code === 'KeyA' ||
      code === 'KeyS' ||
      code === 'KeyD' ||
      code.startsWith('Arrow') ||
      code === 'ShiftLeft' ||
      code === 'ShiftRight'
    );
  }

  /** Enable or disable driving input. Disabling clears any held keys. */
  setEnabled(b: boolean): void {
    if (this.enabled === b) return;
    this.enabled = b;
    if (!b) {
      this.keys.clear();
      this.sinceInput = Infinity;
    }
  }

  update(dt: number): void {
    if (!this.enabled) {
      this.keys.clear();
      this.sinceInput = Infinity;
      return;
    }
    // While a panel is open, treat as hands-off.
    if (document.body.dataset.panel) this.keys.clear();
    if (this.steer !== 0 || this.throttle !== 0) this.sinceInput = 0;
    else this.sinceInput += dt;
  }

  /** -1 (left) .. 1 (right) */
  get steer(): number {
    if (!this.enabled) return 0;
    let s = 0;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) s -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) s += 1;
    return s;
  }

  /** -1 (brake) .. 1 (accelerate) */
  get throttle(): number {
    if (!this.enabled) return 0;
    let t = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) t += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) t -= 1;
    return t;
  }

  get drift(): boolean {
    if (!this.enabled) return false;
    return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
  }

  /** Player counts as "at the wheel" for a grace window after input. */
  get isActive(): boolean {
    return this.enabled && this.sinceInput < HOLD_TIMEOUT;
  }
}
