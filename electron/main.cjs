// @ts-check
/**
 * EverRoad desktop — main process.
 *
 * The desktop app is a thin, hardened shell around the exact same web bundle
 * `npm run build` produces. It adds no game code and no game state: everything
 * the renderer can ask of it goes through `window.everroad` (see preload.cjs),
 * and that surface grows one named method at a time, on purpose.
 *
 * The browser remains the development target. `npm run dev` is untouched by any
 * of this — see docs/ARCHITECTURE.md §16.
 */
const { app, BrowserWindow, Menu, session, ipcMain } = require('electron');
const { initUpdater } = require('./updater.cjs');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

/** Where `vite build` puts the bundle, relative to this file. */
const DIST_INDEX = path.join(__dirname, '..', 'dist', 'index.html');

/**
 * The one `file:` URL the window is ever allowed to sit on. Derived from the
 * same path `loadFile` is given, so the two cannot drift.
 */
const DIST_URL = pathToFileURL(DIST_INDEX).href;

/** The dev server origin. Mirrors `vite.config.ts`, which pins 5199 strictly. */
const DEV_ORIGIN = 'http://localhost:5199';

/**
 * Load the Vite dev server instead of the built bundle.
 *
 * Opt-in via `ELECTRON_DEV=1`, plus an automatic fallback when an unpackaged
 * run finds no `dist/` to show. `npm run electron` is a smoke run against a
 * real build, so an unpackaged launch does *not* imply the dev server; the
 * documented development workflow is still `npm run dev` in a browser.
 *
 * `!app.isPackaged` gates the whole thing. Without it, a shipped `EverRoad.app`
 * launched with `ELECTRON_DEV=1` in the environment would load whatever answers
 * on port 5199, under a CSP relaxed to allow inline script, and would then
 * treat that origin as its own content. An environment variable must not be
 * able to repoint a released binary.
 */
const DEV = !app.isPackaged && (process.env.ELECTRON_DEV === '1' || !fs.existsSync(DIST_INDEX));

/**
 * Top of the loading-screen gradient in src/style.css. Painted behind the page
 * so the window opens on the game's own colour instead of a white flash.
 */
const BACKGROUND = '#2b1e4e';

/**
 * Content-Security-Policy for every response.
 *
 * Tight by default; each relaxation below is something the shipped page
 * actually needs. `style-src 'unsafe-inline'` covers the inline styles the UI
 * overlay writes. There are no remote hosts here at all: the type is
 * self-hosted from src/fonts/, so `style-src` and `font-src` stay at 'self'
 * and an offline launch renders in the intended faces.
 * `script-src 'self'` with no `unsafe-inline`/`unsafe-eval` is the important
 * one — it is what makes an injected string unable to become code.
 */
function contentSecurityPolicy() {
  // Keyed rather than positional: the dev branch below rewrites two of these
  // by name, so reordering or inserting a directive cannot silently relax the
  // wrong one.
  const directives = {
    'default-src': "'self'",
    'script-src': "'self'",
    'style-src': "'self' 'unsafe-inline'",
    'font-src': "'self'",
    'img-src': "'self' data: blob:",
    'connect-src': "'self'",
    'object-src': "'none'",
    'base-uri': "'none'",
    'frame-src': "'none'",
    // No fallback to default-src, so it has to be said explicitly: the page
    // has no forms and must not be able to post one anywhere.
    'form-action': "'none'",
  };
  if (DEV) {
    // Vite's HMR client is injected inline and talks over a websocket. This
    // branch never runs in a packaged build — DEV is gated on !app.isPackaged.
    directives['script-src'] = `'self' 'unsafe-inline' ${DEV_ORIGIN}`;
    directives['connect-src'] = `'self' ${DEV_ORIGIN} ws://localhost:5199`;
  }
  return Object.entries(directives)
    .map(([name, value]) => `${name} ${value}`)
    .join('; ');
}

/**
 * True for the only content the app is ever allowed to display: the built
 * `dist/index.html`, or the dev server when DEV is on.
 *
 * `file:` is matched exactly, not by protocol. Trusting the scheme would make
 * `file:///etc/passwd` own content, which is the whole value of a navigation
 * guard given away. Fragment and query are stripped first so an in-page anchor
 * still counts as the same document.
 *
 * The string comparison is safe against odd install paths: Chromium commits a
 * percent-encoded file URL, which is the same encoding `pathToFileURL` produces
 * — verified against a directory containing both a space and a non-ASCII
 * character, where the naive `url.format` encoding would have diverged.
 */
function isOwnContent(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'file:') {
      return parsed.href.split('#')[0].split('?')[0] === DIST_URL;
    }
    return DEV && parsed.origin === DEV_ORIGIN;
  } catch {
    return false;
  }
}

function applySessionHardening() {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [contentSecurityPolicy()],
      },
    });
  });

  // Everything is refused except one thing: `clipboard-sanitized-write`, which
  // is what `navigator.clipboard.writeText` asks for. Settings' "Copy save
  // code" button is built on it, and a blanket denial turned that into a
  // "Copy failed" toast in the packaged app while it worked fine in a browser.
  // Camera, microphone, geolocation, notifications and the rest stay denied —
  // the game asks for none of them.
  const ALLOWED_PERMISSION = 'clipboard-sanitized-write';
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === ALLOWED_PERMISSION);
  });
  // The synchronous sibling, consulted by `navigator.permissions.query` and by
  // some internal checks. It has to agree with the handler above, or the answer
  // depends on which path Chromium happened to take.
  session.defaultSession.setPermissionCheckHandler(
    (_wc, permission) => permission === ALLOWED_PERMISSION,
  );
}

/** @type {BrowserWindow | null} */
let mainWindow = null;

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: BACKGROUND,
    // The renderer builds a Three.js scene before it paints anything. Showing
    // the window only on ready-to-show trades a moment of delay for never
    // flashing an empty frame.
    show: false,
    title: 'EverRoad',
    webPreferences: {
      // Non-negotiable. The renderer is untrusted-by-construction: it runs a
      // large third-party render stack, and it must not be able to reach Node.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
      // The preload cannot call app.getVersion() itself under sandbox, so the
      // version rides in on argv. See preload.cjs.
      additionalArguments: [`--everroad-version=${app.getVersion()}`],
      // Chromium throttles rAF in occluded/background windows. The game clamps
      // dt in main.ts and handles that correctly, so leave the default on.
      backgroundThrottling: true,
      spellcheck: false,
    },
  });

  mainWindow = win;

  win.once('ready-to-show', () => win.show());
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });

  // Every popup is denied, and nothing is handed to the real browser.
  //
  // The game has no `window.open`, no anchor and no `target="_blank"`, so an
  // `shell.openExternal` here could only ever be reached by something that
  // was not us — which makes it a way to launch an attacker-chosen URL in the
  // user's browser, and nothing else.
  //
  // The app does now have one real outbound link — the release page the updater
  // offers — and it deliberately does not go through this handler. It is opened
  // by `updater.cjs`, from a URL that module builds out of its own constants,
  // reached by an IPC channel that takes no argument. That keeps the number of
  // renderer-supplied strings that can become a browser navigation at zero,
  // which a host allowlist here would not.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // The page is a single document; it has no reason to navigate anywhere.
  win.webContents.on('will-navigate', (event, url) => {
    if (!isOwnContent(url)) event.preventDefault();
  });
  win.webContents.on('will-redirect', (event, url) => {
    if (!isOwnContent(url)) event.preventDefault();
  });
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());

  if (DEV) {
    void win.loadURL(DEV_ORIGIN);
  } else if (fs.existsSync(DIST_INDEX)) {
    // `base: './'` in vite.config.ts keeps every asset URL relative, which is
    // what makes a file:// load resolve.
    void win.loadFile(DIST_INDEX);
  } else {
    console.error(`EverRoad: no build found at ${DIST_INDEX}. Run \`npm run build\` first.`);
    void win.loadURL(
      'data:text/html,<body style="background:%232b1e4e;color:%23fff7ec;font:16px sans-serif;' +
        'display:grid;place-items:center;height:100vh;margin:0">No build found — run ' +
        '<code>npm run build</code>.</body>',
    );
  }

  return win;
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  // macOS will not give you Cmd+Q, Cmd+C or Cmd+V without an application menu,
  // so a "no menu" desktop build is a broken one on that platform.
  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]
      : []),
    {
      label: '&File',
      submenu: [isMac ? { role: 'close' } : { role: 'quit' }],
    },
    {
      label: '&Edit',
      submenu: [{ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }],
    },
    {
      label: '&View',
      submenu: [
        { role: 'reload' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        // DevTools stay out of release builds: the game has an in-page help
        // panel, and an accidental F12 in a shipped build is only confusing.
        ...(DEV || !app.isPackaged ? [{ type: 'separator' }, { role: 'toggleDevTools' }] : []),
      ],
    },
    {
      label: '&Window',
      submenu: isMac
        ? [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }]
        : [{ role: 'minimize' }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(/** @type {any} */ (template)));
}

/**
 * The gate every inbound IPC message passes. Validated rather than trusted: a
 * request is only honoured from the top frame of the window we created, showing
 * content we recognise. Anything else is dropped silently.
 *
 * Factored out of the quit handler when the updater channels arrived — the
 * failure mode of a *second* channel written to a *slightly different* standard
 * is exactly the one nobody notices, so there is one predicate and every
 * handler starts with it.
 */
function fromTrustedRenderer(event) {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win !== mainWindow) return false;
  let frameUrl = '';
  try {
    const frame = event.senderFrame;
    // A subframe asking to drive the application is exactly the case to refuse.
    if (!frame || frame.parent !== null) return false;
    frameUrl = frame.url;
  } catch {
    // The frame went away between send and handle; nothing to honour.
    return false;
  }
  return isOwnContent(frameUrl);
}

ipcMain.on('everroad:quit', (event) => {
  if (!fromTrustedRenderer(event)) return;
  app.quit();
});

/**
 * The updater, and the four verbs the renderer may aim at it.
 *
 * Note what is *not* here: no channel takes an argument. The renderer can ask
 * for a check, a download, an install, a reveal or the release page, and every
 * one of those acts on state this process derived from the feed itself. There
 * is no URL, no path and no version to pass, so there is nothing for a
 * compromised page to steer. See §16.8.
 */
const updater = initUpdater((status) => {
  // The window can be gone mid-download; a status push is never worth a throw.
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('everroad:update-status', status);
  }
});

/** Pull, for the renderer's first paint — the push channel only carries changes. */
ipcMain.handle('everroad:update-status', (event) =>
  fromTrustedRenderer(event) ? updater.snapshot() : null,
);

for (const [channel, run] of [
  ['everroad:update-check', () => updater.check()],
  ['everroad:update-download', () => updater.download()],
  ['everroad:update-install', () => updater.install()],
  ['everroad:update-reveal', () => updater.reveal()],
  ['everroad:update-open-page', () => updater.openReleasePage()],
]) {
  ipcMain.on(channel, (event) => {
    if (!fromTrustedRenderer(event)) return;
    void run();
  });
}

// A second instance would fight the first over the same localStorage profile.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  // Windows uses this to group taskbar entries and route notifications.
  app.setAppUserModelId('com.trollphace.everroad');

  app.whenReady().then(() => {
    applySessionHardening();
    buildMenu();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    // macOS convention: the app outlives its last window until Cmd+Q.
    if (process.platform !== 'darwin') app.quit();
  });

  // Belt and braces: any WebContents the app did not create itself gets the
  // same unconditional denial.
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  });
}
