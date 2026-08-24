// @ts-check
/**
 * Everroad desktop — the update checker.
 *
 * All of it runs in the main process, deliberately. The renderer's CSP pins
 * `connect-src 'self'` (§16.3) and there is no reason to widen it: the page
 * never talks to GitHub, it only asks this module what it found and renders the
 * answer. Every outbound byte in the app is in this file.
 *
 * The feed is the one `electron-builder` already publishes. Every release the
 * workflow cuts carries `latest.yml` / `latest-mac.yml` / `latest-linux.yml`
 * alongside the artifacts, which is exactly what `electron-updater` consumes —
 * so nothing new is published for the *check*. The one extra asset is
 * `release-meta.json` (scripts/build-release-meta.mjs), which is how a release
 * says whether it changes the save format.
 *
 * ## Two deliveries, and why
 *
 * "Install in place" is not available on every artifact this project ships, and
 * pretending otherwise would mean a Download button that silently does nothing
 * on three of five downloads:
 *
 *   Windows NSIS   in-place   unsigned is fine; SmartScreen warns, as it does today
 *   Linux AppImage in-place   electron-updater swaps the AppImage
 *   macOS          manual     Squirrel.Mac verifies the incoming bundle's
 *                             signature against the running app's. Everroad is
 *                             unsigned (§16.7), so this fails at install with
 *                             "Could not get code signature for running
 *                             application". Not a bug to fix — a certificate to
 *                             buy.
 *   Windows portable  manual  electron-updater does not support the target
 *   Linux rpm         manual  likewise
 *
 * The manual path is not "go find it yourself". This module downloads the same
 * artifact the feed names, verifies its SHA-512, drops it in the user's
 * Downloads folder and reveals it in the file manager. The only difference the
 * player sees is that the last step is theirs.
 */
const { app, net, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

/**
 * `electron-updater` builds its platform updater the first time `autoUpdater`
 * is read, and that constructor calls `app.getVersion()`. Reaching for it at
 * module scope would therefore make this file impossible to require outside a
 * running Electron app — including from a unit test that only wants
 * `deliveryMode`. Resolved on first use instead, well after `app` exists.
 */
let cachedUpdater = null;
function updater() {
  if (cachedUpdater === null) cachedUpdater = require('electron-updater').autoUpdater;
  return cachedUpdater;
}

/**
 * Where releases live. Kept in step with `publish:` in electron-builder.yml —
 * that block tells the *build* where to upload, this one tells the *client*
 * where to look, and they describe the same repository.
 */
const OWNER = 'Troll-Phace';
const REPO = 'everroad';

/** Direct-download base for one release's assets. */
function assetUrl(version, name) {
  return `https://github.com/${OWNER}/${REPO}/releases/download/v${version}/${encodeURIComponent(name)}`;
}

/** The human-readable release page, for the "other downloads" escape hatch. */
function releasePageUrl(version) {
  return `https://github.com/${OWNER}/${REPO}/releases/tag/v${version}`;
}

/** The API record for one release, which is where its body lives as Markdown. */
function releaseApiUrl(version) {
  return `https://api.github.com/repos/${OWNER}/${REPO}/releases/tags/v${version}`;
}

/**
 * How an update can land on this install.
 *
 * Both environment variables are set by electron-builder's own launchers, so
 * this identifies the *artifact* the user actually downloaded rather than
 * guessing from the platform. A Windows user may be running the installer build
 * or the portable .exe, and only one of those can update itself.
 */
function deliveryMode(platform = process.platform, env = process.env) {
  if (platform === 'win32') {
    return env.PORTABLE_EXECUTABLE_DIR ? 'manual' : 'in-place';
  }
  if (platform === 'linux') {
    return env.APPIMAGE ? 'in-place' : 'manual';
  }
  // darwin, and anything unrecognised.
  return 'manual';
}

/**
 * @typedef {'idle'|'checking'|'none'|'available'|'downloading'|'ready'|'error'} UpdatePhase
 *
 * @typedef {object} UpdateStatus
 * @property {UpdatePhase} phase
 * @property {'in-place'|'manual'} delivery   How `install` behaves on this build.
 * @property {string|null} version            The version offered, once known.
 * @property {string|null} notes              Release notes from the feed, if any.
 * @property {number} progress                0..1 while downloading.
 * @property {string|null} fileName           The artifact being fetched, on the manual path.
 * @property {number|null} saveVersion        The offered release's SAVE_VERSION, or null if unknown.
 * @property {number|null} checkedAt          Epoch ms of the last completed check.
 * @property {string|null} error              A human-readable failure, when phase is 'error'.
 */

/** @type {UpdateStatus} */
const status = {
  phase: 'idle',
  delivery: deliveryMode(),
  version: null,
  notes: null,
  progress: 0,
  fileName: null,
  saveVersion: null,
  checkedAt: null,
  error: null,
};

/** The file the manual path wrote, kept out of the renderer's reach. */
let downloadedPath = null;

/**
 * The artifact the last check named, held from check until download.
 *
 * The manual path used to re-run `checkForUpdates()` when Download was pressed,
 * which is a second round trip and, worse, a race: if a release landed between
 * the two calls, the filename came from the new check while `status.version` —
 * and the warning banner the player had just read — came from the old one, and
 * the URL was assembled from one of each.
 *
 * @type {{ version: string, name: string, sha512: string | undefined } | null}
 */
let pendingFile = null;

/** Set while a check or download is in flight, so a double-click cannot start two. */
let busy = false;

/** @type {((s: UpdateStatus) => void)|null} */
let publish = null;

function emit(patch) {
  Object.assign(status, patch);
  if (publish) publish({ ...status });
}

/**
 * Report a failure without ever handing the renderer an exception's guts.
 *
 * `err.message` from the network stack can carry the full request URL and, on a
 * private feed, a token in a query string. The page gets a fixed sentence; the
 * detail goes to the main process's stderr where a bug report can ask for it.
 */
function fail(what, err) {
  console.error(`[updater] ${what}:`, err);
  busy = false;
  emit({ phase: 'error', progress: 0, error: what });
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

/**
 * GET a URL into memory, following redirects (GitHub's download URLs redirect
 * to object storage). Rejects anything that is not a 2xx, and caps the response
 * so a wrong URL answering with something enormous cannot exhaust memory.
 */
function fetchBuffer(url, { limitBytes = 512 * 1024 * 1024, onProgress, headers } = {}) {
  return new Promise((resolve, reject) => {
    const request = net.request({ url, redirect: 'follow' });
    // api.github.com rejects a request with no User-Agent outright. Electron
    // sends a Chrome-shaped one by default, but relying on a default for the
    // difference between 200 and 403 is how this breaks on an Electron bump.
    request.setHeader('User-Agent', `Everroad/${app.getVersion()}`);
    for (const [name, value] of Object.entries(headers ?? {})) {
      request.setHeader(name, value);
    }
    request.on('response', (response) => {
      if (response.statusCode < 200 || response.statusCode >= 300) {
        // Drain, or the socket is held open until GC.
        response.on('data', () => {});
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }
      const total = Number(response.headers['content-length']) || 0;
      /** @type {Buffer[]} */
      const chunks = [];
      let seen = 0;
      response.on('data', (chunk) => {
        seen += chunk.length;
        if (seen > limitBytes) {
          request.abort();
          reject(new Error('response exceeded the size limit'));
          return;
        }
        chunks.push(chunk);
        if (onProgress && total > 0) onProgress(seen / total);
      });
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    });
    request.on('error', reject);
    request.end();
  });
}

/**
 * Filename fragments that identify a build for the architecture we are running.
 *
 * Several spellings per arch because the target decides the name, not Node:
 * electron-builder writes `mac-arm64` and `win-x64`, but `linux-x86_64`.
 */
const ARCH_TOKENS = {
  arm64: ['arm64', 'aarch64'],
  x64: ['x64', 'x86_64', 'amd64'],
};

/**
 * Which Linux package this install came from, and therefore which artifact an
 * update should hand back.
 *
 * `APPIMAGE` is set by the AppImage runtime itself, so it is proof rather than
 * inference. Everything else is the rpm — those are the only two Linux targets
 * electron-builder.yml builds — but this checks the rpm database rather than
 * assuming, because an AppImage that was extracted and run directly does not
 * get `APPIMAGE` set, and handing that user an `.rpm` would be a second wrong
 * file for the same reason as the first. When there is no rpm database, the
 * AppImage is the artifact that runs anywhere, so it is the safer default.
 */
function linuxPackageFormat(env = process.env, exists = fs.existsSync) {
  if (env.APPIMAGE) return 'AppImage';
  return exists('/var/lib/rpm') ? 'rpm' : 'AppImage';
}

/**
 * Choose which of the feed's files this machine should actually download.
 *
 * Emphatically not `files[0]`, and not the feed's top-level `path` either —
 * both of those are the *first* entry, and `latest-mac.yml` lists x64 first.
 * Taking either handed every Apple Silicon user the Intel build: it runs under
 * Rosetta, so nothing visibly fails, it is just permanently the wrong binary
 * and 2 MB larger. Found by running the real thing on an arm64 machine.
 *
 * This only governs the manual path. On the in-place path electron-updater
 * resolves the artifact itself, and it gets the arch right.
 *
 * On macOS the `.dmg` is preferred over the `.zip` when both match, because the
 * manual path ends with a human installing the thing by hand and a disk image
 * with a drag arrow is the convention there.
 *
 * On Linux the arch token is not enough on its own, which is what made this
 * function wrong for the rpm. Both Linux artifacts are `linux-x86_64`, so both
 * survive the arch filter and `candidates[0]` handed every rpm user the
 * AppImage — a 128 MB file dropped in Downloads that their package manager
 * cannot install. Exactly the macOS arch bug above, one axis over: the feed
 * lists more than one artifact per platform, and order is not an answer.
 */
function pickFile(
  files,
  platform = process.platform,
  arch = process.arch,
  env = process.env,
  exists = fs.existsSync,
) {
  if (!files || files.length === 0) return null;
  const tokens = ARCH_TOKENS[arch] ?? [];
  const named = files.map((file) => ({ file, name: path.basename(file.url) }));

  // An unrecognised arch keeps every candidate rather than none: a wrong-arch
  // download the user can see the name of beats no download at all.
  const matching = named.filter(({ name }) => tokens.some((token) => name.includes(token)));
  const candidates = matching.length > 0 ? matching : named;

  if (platform === 'darwin') {
    const dmg = candidates.find(({ name }) => name.endsWith('.dmg'));
    if (dmg) return dmg;
  }
  if (platform === 'linux') {
    const wanted = `.${linuxPackageFormat(env, exists)}`;
    const match = candidates.find(({ name }) => name.toLowerCase().endsWith(wanted.toLowerCase()));
    if (match) return match;
  }
  return candidates[0];
}

/**
 * The offered release's notes, as the Markdown they were written in.
 *
 * Not taken from `updateInfo.releaseNotes`, which is the trap here. On the
 * GitHub provider that field is an *array* of `{version, note}`, and each
 * `note` is the HTML GitHub rendered into its Atom feed — `<h3>`, `<ul>`,
 * `<br>` and entity escapes. Rendering it would mean putting network-sourced
 * markup into the DOM, which the patch-notes path deliberately never does
 * (src/ui/markdown.ts), and parsing it would mean a second, HTML-shaped parser
 * for text that exists in a better form one request away.
 *
 * That better form is the release body. `scripts/release-notes.mjs` sets it to
 * the version's own CHANGELOG.md section at release time, so this returns
 * exactly the Markdown the What's New panel already renders, from the same
 * source of truth, through the same parser.
 *
 * Null on any failure — the update is still worth offering without its notes.
 */
async function fetchReleaseNotes(version) {
  try {
    const raw = await fetchBuffer(releaseApiUrl(version), {
      limitBytes: 1024 * 1024,
      headers: { Accept: 'application/vnd.github+json' },
    });
    const release = JSON.parse(raw.toString('utf8'));
    return typeof release.body === 'string' && release.body.trim() !== '' ? release.body : null;
  } catch (err) {
    console.warn('[updater] could not read the release notes for', version, '-', err);
    return null;
  }
}

/**
 * The offered release's `release-meta.json`, or null.
 *
 * Null is an ordinary answer, not a failure: releases cut before this feature
 * existed have no such asset, and the UI is written to say "unknown" rather
 * than to assume "safe". Only a *present and parseable* file can claim the
 * save format is unchanged.
 */
async function fetchSaveVersion(version) {
  try {
    const raw = await fetchBuffer(assetUrl(version, 'release-meta.json'), {
      limitBytes: 64 * 1024,
    });
    const meta = JSON.parse(raw.toString('utf8'));
    return typeof meta.saveVersion === 'number' ? meta.saveVersion : null;
  } catch (err) {
    console.warn('[updater] no release metadata for', version, '-', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// The check
// ---------------------------------------------------------------------------

/**
 * Ask the feed whether anything newer exists. Renderer-initiated, always: the
 * main process never reaches the network on its own, so the "check on launch"
 * preference in Settings is the whole story rather than a second switch on top
 * of one that already fired.
 */
async function check() {
  if (busy) return;
  if (!app.isPackaged) {
    // `electron-updater` refuses to run unpackaged, and a dev build has no
    // release to compare itself against anyway.
    emit({ phase: 'none', checkedAt: Date.now(), error: null });
    return;
  }
  busy = true;
  emit({ phase: 'checking', error: null, progress: 0 });
  try {
    const result = await updater().checkForUpdates();
    // `checkForUpdates` resolves with null when it declined to run at all.
    if (!result || !result.updateInfo) {
      busy = false;
      emit({ phase: 'none', checkedAt: Date.now() });
      return;
    }
    const version = result.updateInfo.version;
    if (version === app.getVersion()) {
      busy = false;
      pendingFile = null;
      emit({ phase: 'none', version: null, checkedAt: Date.now() });
      return;
    }
    const picked = pickFile(result.updateInfo.files);
    pendingFile = picked ? { version, name: picked.name, sha512: picked.file.sha512 } : null;
    // Both are optional detail about a release we have already decided to
    // offer, and both fail to null, so they run together rather than adding two
    // round trips to the check.
    const [notes, saveVersion] = await Promise.all([
      fetchReleaseNotes(version),
      fetchSaveVersion(version),
    ]);
    busy = false;
    emit({
      phase: 'available',
      version,
      notes,
      checkedAt: Date.now(),
      saveVersion,
    });
  } catch (err) {
    fail('Could not reach the update server', err);
  }
}

// ---------------------------------------------------------------------------
// The download
// ---------------------------------------------------------------------------

/** Base64 SHA-512 of a buffer, the encoding electron-builder writes into the feed. */
function sha512(buffer) {
  return crypto.createHash('sha512').update(buffer).digest('base64');
}

/** `Everroad-0.1.18-mac-arm64 (1).zip` — never silently overwrite a previous download. */
function freePath(dir, name) {
  const ext = path.extname(name);
  const stem = path.basename(name, ext);
  let candidate = path.join(dir, name);
  for (let n = 1; fs.existsSync(candidate) && n < 100; n++) {
    candidate = path.join(dir, `${stem} (${n})${ext}`);
  }
  return candidate;
}

/**
 * The manual path: fetch the artifact the feed names, check its hash, and put
 * it in Downloads.
 *
 * The hash matters more here than on the in-place path, where electron-updater
 * does its own verification. This writes an executable installer into the
 * user's filesystem, so it verifies the bytes against the SHA-512 the signed-
 * over-TLS feed declared before that file is allowed to exist under its real
 * name. A mismatch deletes it.
 */
async function downloadManually() {
  // Whatever the check found, from the same check whose version the player was
  // shown. Never re-resolved here.
  const file = pendingFile;
  if (!file) throw new Error('the feed named no downloadable file');

  const { name } = file;
  emit({ fileName: name });
  const bytes = await fetchBuffer(assetUrl(file.version, name), {
    onProgress: (p) => emit({ progress: p }),
  });

  if (file.sha512 && sha512(bytes) !== file.sha512) {
    throw new Error('checksum mismatch — the download does not match the release');
  }

  const target = freePath(app.getPath('downloads'), name);
  // Written to a neighbouring temp name first, so an interrupted write cannot
  // leave a half-file sitting in Downloads under a name that looks complete.
  const temp = `${target}.part`;
  fs.writeFileSync(temp, bytes);
  fs.renameSync(temp, target);
  downloadedPath = target;
}

/** Start fetching the pending update, by whichever route this build supports. */
async function download() {
  if (busy || status.phase !== 'available' || !status.version) return;
  busy = true;
  emit({ phase: 'downloading', progress: 0, error: null });
  try {
    if (status.delivery === 'in-place') {
      await updater().downloadUpdate();
    } else {
      await downloadManually();
    }
    busy = false;
    emit({ phase: 'ready', progress: 1 });
  } catch (err) {
    fail('The download failed', err);
  }
}

// ---------------------------------------------------------------------------
// Finishing
// ---------------------------------------------------------------------------

/**
 * Quit into the installer. In-place builds only; on the manual path the
 * renderer offers Reveal instead, and calling this there would do nothing.
 *
 * `isSilent: false` on purpose — the NSIS installer is unsigned, so the user
 * meets SmartScreen. A silent install that appears to hang behind an invisible
 * prompt is worse than an installer window they can answer.
 */
function install() {
  if (status.phase !== 'ready' || status.delivery !== 'in-place') return;
  updater().quitAndInstall(false, true);
}

/** Show the downloaded artifact in Finder / Explorer / the file manager. */
function reveal() {
  if (!downloadedPath || !fs.existsSync(downloadedPath)) return;
  shell.showItemInFolder(downloadedPath);
}

/**
 * Open this release's page in the user's browser — the only outbound link the
 * app has, and the reason §16.2's blanket `openExternal` ban is relaxed here.
 *
 * The URL is *built* from two module constants and a version string the update
 * feed supplied, never passed in from the renderer. There is no argument to
 * this function precisely so that a compromised page has no string to steer it
 * with; the worst it can do is open Everroad's own releases page.
 */
function openReleasePage() {
  if (!status.version) return;
  void shell.openExternal(releasePageUrl(status.version));
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

/**
 * @param {(s: UpdateStatus) => void} onStatus Pushes each change to the renderer.
 */
function initUpdater(onStatus) {
  publish = onStatus;

  const au = updater();
  au.autoDownload = false;
  au.autoInstallOnAppQuit = false;
  // Required, not a preference. `release.yml` marks every 0.x release a GitHub
  // prerelease (§16.7), and left at its default the provider resolves the
  // newest version through `/releases/latest` — an endpoint that excludes
  // prereleases. Every release this project has ever cut is invisible to it,
  // so the updater would cheerfully report "up to date" forever.
  //
  // Turning it on does not opt into a beta channel. The tags are plain semver
  // (`v0.1.17`, no `-beta` suffix), so `semver.prerelease` reads no channel off
  // the running version and GitHubProvider takes the newest entry in the
  // releases Atom feed instead. Drafts are not in that feed, which is what
  // keeps a half-finished release from being offered to anyone.
  au.allowPrerelease = true;
  // A version lower than the running one is never offered. The relevant case is
  // a player on a build newer than the newest release (a local build); walking
  // them backwards would hand them a save their own build has already refused.
  au.allowDowngrade = false;

  au.on('download-progress', (p) => {
    if (status.phase === 'downloading') emit({ progress: (p.percent || 0) / 100 });
  });
  // Logged, never reported. Both `checkForUpdates` and `downloadUpdate` reject
  // on failure and are caught at their call sites, where the wording can say
  // which of the two went wrong; reporting here as well set `phase: 'error'`
  // twice for one failure, with the vaguer message arriving first.
  au.on('error', (err) => console.error('[updater] electron-updater:', err));

  return { check, download, install, reveal, openReleasePage, snapshot: () => ({ ...status }) };
}

// `pickFile` and `deliveryMode` are exported for their unit tests. Both take
// the platform and arch as parameters precisely so those tests can drive every
// combination this project ships from one machine.
module.exports = { initUpdater, deliveryMode, pickFile, linuxPackageFormat };
