/**
 * Keyboard input for driving. Panel/menu keys are handled by the UI module;
 * driving input is ignored while a panel is open (body.dataset.panel set).
 */

const HOLD_TIMEOUT = 4; // seconds after last steer input before autopilot resumes

export class Input {
  private keys = new Set<string>();
  /** Seconds since last driving input. */
  private sinceInput = Infinity;

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (this.shouldIgnore(e)) return;
      this.keys.add(e.code);
      if (this.isDriveKey(e.code)) {
        this.sinceInput = 0;
        // Don't let arrows scroll the page
        if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
    window.addEventListener('blur', () => this.keys.clear());
  }

  private shouldIgnore(e: KeyboardEvent): boolean {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return true;
    if (document.body.dataset.panel) return true;
    return false;
  }

  private isDriveKey(code: string): boolean {
    return (
      code === 'KeyW' || code === 'KeyA' || code === 'KeyS' || code === 'KeyD' ||
      code.startsWith('Arrow') || code === 'ShiftLeft' || code === 'ShiftRight'
    );
  }

  update(dt: number): void {
    // While a panel is open, treat as hands-off.
    if (document.body.dataset.panel) this.keys.clear();
    if (this.steer !== 0 || this.throttle !== 0) this.sinceInput = 0;
    else this.sinceInput += dt;
  }

  /** -1 (left) .. 1 (right) */
  get steer(): number {
    let s = 0;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) s -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) s += 1;
    return s;
  }

  /** -1 (brake) .. 1 (accelerate) */
  get throttle(): number {
    let t = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) t += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) t -= 1;
    return t;
  }

  get drift(): boolean {
    return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
  }

  /** Player counts as "at the wheel" for a grace window after input. */
  get isActive(): boolean {
    return this.sinceInput < HOLD_TIMEOUT;
  }
}
