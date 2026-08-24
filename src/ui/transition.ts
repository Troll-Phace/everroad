/**
 * The mode fade.
 *
 * `actions.startGame()` / `actions.quitToMenu()` are synchronous and
 * instantaneous — the engine swaps worlds in one call. The *visible*
 * transition belongs entirely to the UI: a full-screen cover fades to black,
 * the swap happens while the world is hidden behind it, then the cover fades
 * back out onto the new scene.
 *
 * Only one transition runs at a time; while one is in flight the cover takes
 * pointer events, and `busy` lets keyboard activations be ignored too.
 */

/** Fade-to-black before the swap. Long enough to read as intent, short enough not to drag. */
const FADE_OUT_MS = 320;

/** Fade back in after the swap — slower, so the new scene arrives gently. */
const FADE_IN_MS = 500;

/**
 * Reduced-motion timings. The cover is shortened, never skipped: it is what
 * hides the world being torn down and rebuilt, so removing it would expose a
 * hard visual snap rather than remove motion.
 */
const REDUCED_OUT_MS = 90;
const REDUCED_IN_MS = 120;

/** Slack after the fade-in so the cover is fully transparent before it is re-armed. */
const SETTLE_MS = 40;

export interface ModeTransition {
  /** True while a fade is in flight. Callers must ignore activations until it clears. */
  readonly busy: boolean;
  /**
   * Fade out, run `swap` under the cover, then fade back in. Calls made while
   * a transition is already running are dropped.
   */
  run(swap: () => void): void;
}

export function createModeTransition(): ModeTransition {
  const cover = document.createElement('div');
  cover.className = 'mode-cover';
  cover.setAttribute('aria-hidden', 'true');
  document.body.append(cover);

  let busy = false;

  return {
    get busy(): boolean {
      return busy;
    },

    run(swap: () => void): void {
      if (busy) return;
      busy = true;

      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const outMs = reduced ? REDUCED_OUT_MS : FADE_OUT_MS;
      const inMs = reduced ? REDUCED_IN_MS : FADE_IN_MS;

      cover.style.transitionDuration = `${outMs}ms`;
      // `is-active` takes pointer events for the whole run, so nothing behind
      // the cover can be clicked twice.
      cover.classList.add('is-active', 'is-opaque');

      window.setTimeout(() => {
        try {
          swap();
        } finally {
          cover.style.transitionDuration = `${inMs}ms`;
          // Let the swap's DOM writes paint under the opaque cover before the
          // fade back in starts.
          requestAnimationFrame(() => cover.classList.remove('is-opaque'));
          window.setTimeout(() => {
            cover.classList.remove('is-active');
            busy = false;
          }, inMs + SETTLE_MS);
        }
      }, outMs);
    },
  };
}
