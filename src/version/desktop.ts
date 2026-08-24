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

/** How far the updater can carry an update on this particular install. */
export type UpdateDelivery = 'in-place' | 'manual';

/**
 * Where the updater has got to. Mirrors the `UpdateStatus` typedef in
 * `electron/updater.cjs`; that module is the only writer.
 */
export type UpdatePhase =
  /** Nothing has been asked of it yet. */
  | 'idle'
  /** A check is in flight. */
  | 'checking'
  /** Checked, and this build is current. */
  | 'none'
  /** A newer release exists and has not been fetched. */
  | 'available'
  /** Fetching it. `progress` is live. */
  | 'downloading'
  /** Fetched and verified; `install` or `reveal` finishes the job. */
  | 'ready'
  /** Something went wrong; `error` says what, in one sentence. */
  | 'error';

export interface UpdateStatus {
  readonly phase: UpdatePhase;
  /** Whether `install()` can restart into the update, or the user finishes by hand. */
  readonly delivery: UpdateDelivery;
  /** The version being offered, once a check has found one. */
  readonly version: string | null;
  /** The offered release's notes — its CHANGELOG section, as Markdown. */
  readonly notes: string | null;
  /** 0..1 while downloading. */
  readonly progress: number;
  /** The artifact being fetched, on the manual path. */
  readonly fileName: string | null;
  /**
   * `SAVE_VERSION` in the offered release, from its `release-meta.json`.
   *
   * `null` means *unknown*, not *unchanged* — releases cut before that asset
   * existed simply do not carry it. The UI must say so rather than reassure.
   */
  readonly saveVersion: number | null;
  /** Epoch ms of the last completed check. */
  readonly checkedAt: number | null;
  readonly error: string | null;
}

/**
 * The updater verbs.
 *
 * None of them takes an argument, and that is load-bearing rather than
 * incidental: everything they act on was derived by the main process from the
 * update feed, so there is no URL, path or version for this side to supply —
 * and therefore none for a compromised page to choose. See ARCHITECTURE §16.8.
 */
export interface EverroadUpdates {
  /** The current status, for the first paint. */
  status(): Promise<UpdateStatus>;
  /** Subscribe to changes; returns its own unsubscribe. */
  subscribe(listener: (status: UpdateStatus) => void): () => void;
  /** Ask the feed whether anything newer exists. */
  check(): void;
  /** Fetch the pending update. */
  download(): void;
  /** Restart into the installer. `delivery === 'in-place'` only. */
  install(): void;
  /** Show the downloaded file in the OS file manager. `delivery === 'manual'` only. */
  reveal(): void;
  /** Open the offered release's page in the user's browser. */
  openReleasePage(): void;
}

/** The complete main-process surface available to the renderer. */
export interface EverroadDesktop {
  /** The packaged app's version, from `app.getVersion()`. */
  readonly version: string;
  /** Host platform, for the build badge and platform-specific copy. */
  readonly platform: DesktopPlatform;
  /** Ask the main process to quit the app. A no-op request in the browser. */
  quit(): void;
  /**
   * The updater, absent in the web build and on any desktop build whose preload
   * predates it. Every caller handles the `undefined`.
   */
  readonly updates?: EverroadUpdates;
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

/**
 * The updater bridge, or `null` when this build has none — the web build, or a
 * desktop shell whose preload is older than this renderer.
 *
 * Checked separately from `desktop()` rather than folded into it on purpose. A
 * half-formed `updates` object should cost the player the update affordance and
 * nothing else; folding it into the main shape check would make it cost them
 * Quit to Desktop as well, which has no relation to it.
 */
export function desktopUpdates(): EverroadUpdates | null {
  const bridge = desktop();
  const updates = bridge?.updates;
  if (!updates || typeof updates !== 'object') return null;
  for (const method of [
    'status',
    'subscribe',
    'check',
    'download',
    'install',
    'reveal',
    'openReleasePage',
  ] as const) {
    if (typeof updates[method] !== 'function') return null;
  }
  return updates;
}
