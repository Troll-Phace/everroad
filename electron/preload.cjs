// @ts-check
/**
 * EverRoad desktop — preload.
 *
 * The entire main <-> renderer surface. `contextBridge` copies a frozen object
 * onto `window.everroad`; nothing else crosses. In particular there is no
 * `ipcRenderer`, no `require` and no `fs` on the other side, so a compromised
 * renderer gains no more than a browser tab would.
 *
 * Every member is a named verb with a main-side handler that validates its
 * sender, and — for the updater — none of them takes an argument. A page that
 * has been made to say something it should not can ask for a check, a download
 * or an install; it cannot say *of what*, because there is no parameter to say
 * it in. That is the property a generic `invoke(channel, ...args)` bridge gives
 * away, and it is why this one is tedious instead.
 *
 * The web build has no preload, `window.everroad` is simply absent, and
 * `src/version/desktop.ts` returns null. Every desktop affordance in the UI is
 * written against that null.
 */
const { contextBridge, ipcRenderer } = require('electron');

/**
 * The app version, handed in by the main process via `additionalArguments`.
 *
 * Not `process.env.npm_package_version`: that is set by npm when running from a
 * checkout and is absent in a packaged app, which is the case that matters.
 * `app.getVersion()` in the main process reads the packaged package.json, so
 * passing its result through argv is the one route that is correct in both.
 */
function versionFromArgv() {
  const prefix = '--everroad-version=';
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : '0.0.0';
}

/**
 * Fan the main process's status pushes out to renderer subscribers.
 *
 * The `ipcRenderer.on` listener is registered once, here in the preload, and
 * the callbacks it calls are ordinary page functions. Handing the raw
 * `ipcRenderer` across the bridge so the page could subscribe itself would give
 * it every channel in the application, which is the whole thing this file
 * exists to prevent.
 */
const updateListeners = new Set();
ipcRenderer.on('everroad:update-status', (_event, status) => {
  for (const listener of updateListeners) {
    try {
      listener(status);
    } catch (err) {
      // One bad subscriber must not stop the others being told.
      console.error('[everroad] update listener threw', err);
    }
  }
});

contextBridge.exposeInMainWorld('everroad', {
  version: versionFromArgv(),
  platform: process.platform,
  quit: () => ipcRenderer.send('everroad:quit'),
  updates: {
    /** The updater's state right now, for the renderer's first paint. */
    status: () => ipcRenderer.invoke('everroad:update-status'),
    /** Subscribe to every subsequent change. Returns an unsubscribe function. */
    subscribe: (listener) => {
      updateListeners.add(listener);
      return () => updateListeners.delete(listener);
    },
    check: () => ipcRenderer.send('everroad:update-check'),
    download: () => ipcRenderer.send('everroad:update-download'),
    install: () => ipcRenderer.send('everroad:update-install'),
    reveal: () => ipcRenderer.send('everroad:update-reveal'),
    openReleasePage: () => ipcRenderer.send('everroad:update-open-page'),
  },
});
