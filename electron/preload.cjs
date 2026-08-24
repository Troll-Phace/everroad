// @ts-check
/**
 * Everroad desktop — preload.
 *
 * The entire main <-> renderer surface. `contextBridge` copies a frozen,
 * three-member object onto `window.everroad`; nothing else crosses. In
 * particular there is no `ipcRenderer`, no `require` and no `fs` on the other
 * side, so a compromised renderer gains no more than a browser tab would.
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

contextBridge.exposeInMainWorld('everroad', {
  version: versionFromArgv(),
  platform: process.platform,
  quit: () => ipcRenderer.send('everroad:quit'),
});
