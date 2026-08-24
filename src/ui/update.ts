/**
 * The renderer's view of the desktop updater.
 *
 * A thin store over `window.everroad.updates` (src/version/desktop.ts): it
 * holds the last status the main process pushed, hands it to whoever asks, and
 * decides the one thing main cannot — whether the offered release changes the
 * save format, which needs `SAVE_VERSION` from this bundle to compare against.
 *
 * Everything here is a no-op in the web build. `desktopUpdates()` returns null,
 * `current()` stays on a resting status whose phase is `'none'`, and every
 * caller renders nothing. The browser remains the primary target (§16.1) and
 * pays for none of this.
 */
import { SAVE_VERSION } from '../types';
import { desktopUpdates, type UpdateStatus } from '../version/desktop';

/**
 * Whether to look for updates when the game starts.
 *
 * Its own localStorage key rather than a field in `state.settings`, for the
 * same reason What's New keeps its own (panelWhatsNew.ts): this is a property
 * of the *install*, not of the journey, and it must not ride along in an
 * exported save code and turn up on someone else's machine.
 */
const CHECK_ON_LAUNCH_KEY = 'everroad-update-check-on-launch';

/** The status a build with no updater sits on forever. */
const RESTING: UpdateStatus = {
  phase: 'none',
  delivery: 'manual',
  version: null,
  notes: null,
  progress: 0,
  fileName: null,
  saveVersion: null,
  checkedAt: null,
  error: null,
};

let status: UpdateStatus = RESTING;
const listeners = new Set<(s: UpdateStatus) => void>();

/** True once the launch check has been attempted, so it happens exactly once. */
let launchChecked = false;

/** The bridge, resolved once. `null` in the browser. */
const bridge = desktopUpdates();

if (bridge) {
  bridge.subscribe((next) => {
    status = next;
    for (const listener of listeners) listener(status);
  });
  // The push channel only carries changes, so pull the state that already
  // exists. A check started before the renderer finished booting would
  // otherwise be invisible until it moved again.
  void bridge
    .status()
    .then((initial) => {
      if (!initial) return;
      status = initial;
      for (const listener of listeners) listener(status);
    })
    .catch(() => {
      /* the bridge went away; the resting status is a fine answer */
    });
}

/** True when this build can update itself at all. */
export function updatesSupported(): boolean {
  return bridge !== null;
}

/** The last status the main process reported. */
export function current(): UpdateStatus {
  return status;
}

/** Subscribe to status changes. Returns its own unsubscribe. */
export function onUpdateStatus(listener: (s: UpdateStatus) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** True when there is a release to tell the player about. */
export function updateOffered(s: UpdateStatus = status): boolean {
  return s.version !== null && s.phase !== 'none' && s.phase !== 'checking' && s.phase !== 'idle';
}

/**
 * Whether the player's stored journey survives the offered release.
 *
 * `'unknown'` is a real answer and must not be flattened into `'safe'`:
 * releases cut before `release-meta.json` existed carry no save version, and a
 * warning that stays silent when it does not know is a warning nobody can rely
 * on.
 */
export type SaveImpact = 'safe' | 'breaking' | 'unknown';

export function saveImpact(s: UpdateStatus = status): SaveImpact {
  if (s.saveVersion === null) return 'unknown';
  return s.saveVersion > SAVE_VERSION ? 'breaking' : 'safe';
}

// ---- preference ------------------------------------------------------------

/**
 * Default on. Storage failures answer "yes" rather than "no": a private-mode
 * profile that cannot remember the preference should still be told about
 * security-relevant updates, and the check is one request per launch.
 */
export function checksOnLaunch(): boolean {
  try {
    return localStorage.getItem(CHECK_ON_LAUNCH_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setChecksOnLaunch(on: boolean): void {
  try {
    localStorage.setItem(CHECK_ON_LAUNCH_KEY, on ? 'on' : 'off');
  } catch {
    /* the preference simply does not persist */
  }
}

// ---- verbs -----------------------------------------------------------------

/** Ask for a check now, whatever the launch preference says. */
export function checkNow(): void {
  bridge?.check();
}

/**
 * The once-per-launch check, honouring the preference.
 *
 * Renderer-initiated by design: the main process never reaches the network on
 * its own, so turning the preference off means no request is made rather than a
 * request whose answer is discarded.
 */
export function checkOnLaunch(): void {
  if (launchChecked || !bridge) return;
  launchChecked = true;
  if (!checksOnLaunch()) return;
  bridge.check();
}

export function startDownload(): void {
  bridge?.download();
}

export function installUpdate(): void {
  bridge?.install();
}

export function revealDownload(): void {
  bridge?.reveal();
}

export function openReleasePage(): void {
  bridge?.openReleasePage();
}
