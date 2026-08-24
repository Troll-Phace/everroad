/**
 * Two-step confirmation for destructive buttons.
 *
 * DESIGN_SYSTEM §4.2: an irreversible action arms on the first click,
 * relabelling itself to state what will happen, and commits only on a second
 * click inside the window. Shared by Reset save and by New Journey when there
 * is an existing journey to erase.
 */

/**
 * How long an armed destructive button waits for its confirming click before
 * dropping back to its idle label. 3s is long enough to read the new label and
 * short enough that a stale armed button is never clicked by accident.
 */
export const CONFIRM_WINDOW_MS = 3000;

export interface ArmedButton {
  /** Force the button back to its idle label (e.g. after a re-render or a state change). */
  reset(): void;
}

export interface ArmConfirmOptions {
  /** Idle label. */
  idle: string;
  /** Label shown while armed — say what the second click will do. */
  armed: string;
  /** Runs on the confirming click (or immediately when `needsConfirm` is false). */
  onConfirm: () => void;
  /**
   * Node whose text is swapped between the two labels. Defaults to the button
   * itself; pass a child when the button has richer content.
   */
  label?: HTMLElement;
  /**
   * When supplied and it returns false, the action is not destructive right
   * now and fires on a single click. Evaluated per click.
   */
  needsConfirm?: () => boolean;
}

export function armConfirm(btn: HTMLButtonElement, opts: ArmConfirmOptions): ArmedButton {
  const label = opts.label ?? btn;
  let armed = false;
  let timer = 0;

  function disarm(): void {
    window.clearTimeout(timer);
    timer = 0;
    armed = false;
    label.textContent = opts.idle;
    btn.classList.remove('btn-danger');
  }

  btn.addEventListener('click', () => {
    if (opts.needsConfirm && !opts.needsConfirm()) {
      disarm();
      opts.onConfirm();
      return;
    }
    if (!armed) {
      armed = true;
      label.textContent = opts.armed;
      btn.classList.add('btn-danger');
      timer = window.setTimeout(disarm, CONFIRM_WINDOW_MS);
      return;
    }
    disarm();
    opts.onConfirm();
  });

  return { reset: disarm };
}
