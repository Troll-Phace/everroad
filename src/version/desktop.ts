/**
 * The typed view of the Electron bridge.
 *
 * `electron/preload.cjs` exposes exactly this object on `window.everroad` via
 * `contextBridge`, and it is the *only* channel between the renderer and the
 * main process — there is no `ipcRenderer`, no `require`, no `fs`. Anything the
 * desktop app needs to do that a web page cannot gets added here, deliberately,
 * one method at a time.
 *
 * In the browser the global is simply absent, which is how `runtime()` tells
 * the two builds apart. Every caller must handle `null`: the web build is the
 * primary target and the bridge is strictly additive.
 *
 * Leaf module — imports nothing from the game (ARCHITECTURE.md §3.4).
 */

/**
 * `process.platform` as the main process reported it.
 *
 * Typed as a loose string union rather than `NodeJS.Platform` on purpose: this
 * module compiles into the browser bundle, and pulling `@types/node` into the
 * renderer's global scope to narrow a string it only ever displays is a bad
 * trade. The listed members exist for autocomplete.
 */
export type DesktopPlatform = 'darwin' | 'win32' | 'linux' | (string & {});

/** The complete main-process surface available to the renderer. */
export interface EverroadDesktop {
  /** The packaged app's version, from `app.getVersion()`. */
  readonly version: string;
  /** Host platform, for the build badge and platform-specific copy. */
  readonly platform: DesktopPlatform;
  /** Ask the main process to quit the app. A no-op request in the browser. */
  quit(): void;
}

declare global {
  interface Window {
    /** Present only in the Electron build. See `electron/preload.cjs`. */
    everroad?: EverroadDesktop;
  }
}

/**
 * The Electron bridge, or `null` when running as a plain web page.
 *
 * Shape-checked rather than merely presence-checked: `window.everroad` is a
 * name any extension or userscript could squat on, and a partially-formed
 * object would fail later at a call site instead of here.
 */
export function desktop(): EverroadDesktop | null {
  if (typeof window === 'undefined') return null;
  const bridge = window.everroad;
  if (!bridge || typeof bridge !== 'object') return null;
  if (typeof bridge.version !== 'string') return null;
  if (typeof bridge.platform !== 'string') return null;
  if (typeof bridge.quit !== 'function') return null;
  return bridge;
}
