/**
 * The two pure decisions in the updater: which artifact this machine should
 * download, and whether it can install one in place.
 *
 * Both take platform/arch as parameters rather than reading `process` directly,
 * so every combination EverRoad ships can be driven from one machine — which is
 * the point, since only macOS arm64 is ever exercised by hand (#53).
 */
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// The updater is CommonJS (it is main-process code), so it is pulled in through
// a require rather than an import. It destructures `electron` at module scope,
// which outside Electron resolves to a path string — every binding comes back
// undefined and nothing throws, so the pure helpers below are reachable.
const { pickFile, deliveryMode, linuxPackageFormat } = createRequire(import.meta.url)(
  './updater.cjs',
);

/** The macOS feed, in the order `latest-mac.yml` actually lists it. */
const MAC_FILES = [
  { url: 'EverRoad-0.1.17-mac-x64.zip', sha512: 'a' },
  { url: 'EverRoad-0.1.17-mac-arm64.zip', sha512: 'b' },
  { url: 'EverRoad-0.1.17-mac-x64.dmg', sha512: 'c' },
  { url: 'EverRoad-0.1.17-mac-arm64.dmg', sha512: 'd' },
];

/**
 * The Linux feed, in the order `latest-linux.yml` actually lists it — both
 * artifacts carry the same `linux-x86_64` token, which is what let the AppImage
 * win on an rpm install.
 */
const LINUX_FILES = [
  { url: 'EverRoad-0.1.19-linux-x86_64.AppImage', sha512: 'a' },
  { url: 'EverRoad-0.1.19-linux-x86_64.rpm', sha512: 'b' },
];

/** `fs.existsSync` stubs: a machine with an rpm database, and one without. */
const hasRpmDb = (p: string): boolean => p === '/var/lib/rpm';
const noRpmDb = (): boolean => false;

describe('pickFile', () => {
  it('does not hand an Apple Silicon machine the Intel build', () => {
    // The regression this exists for: x64 is listed first, so `files[0]` — and
    // the feed's own top-level `path` — are both the wrong binary on arm64.
    expect(pickFile(MAC_FILES, 'darwin', 'arm64').name).toBe('EverRoad-0.1.17-mac-arm64.dmg');
  });

  it('picks the Intel build on an Intel Mac', () => {
    expect(pickFile(MAC_FILES, 'darwin', 'x64').name).toBe('EverRoad-0.1.17-mac-x64.dmg');
  });

  it('prefers the dmg over the zip on macOS, where a human finishes the install', () => {
    const zipOnly = MAC_FILES.filter((f) => f.url.endsWith('.zip'));
    expect(pickFile(zipOnly, 'darwin', 'arm64').name).toBe('EverRoad-0.1.17-mac-arm64.zip');
  });

  it('matches the linux x86_64 spelling, which does not contain "x64"', () => {
    const files = [{ url: 'EverRoad-0.1.17-linux-x86_64.AppImage', sha512: 'a' }];
    expect(pickFile(files, 'linux', 'x64').name).toBe('EverRoad-0.1.17-linux-x86_64.AppImage');
  });

  it('hands an rpm install the rpm, not the AppImage listed above it', () => {
    // The regression this exists for: both files match the arch, the AppImage
    // is listed first, and an rpm user got a 128 MB file dnf cannot install.
    expect(pickFile(LINUX_FILES, 'linux', 'x64', {}, hasRpmDb).name).toBe(
      'EverRoad-0.1.19-linux-x86_64.rpm',
    );
  });

  it('hands an AppImage install the AppImage even on an rpm-based distro', () => {
    // Fedora running the AppImage: the rpm database exists, but APPIMAGE is
    // proof of what is actually running and outranks it.
    const env = { APPIMAGE: '/home/u/EverRoad-0.1.19-linux-x86_64.AppImage' };
    expect(pickFile(LINUX_FILES, 'linux', 'x64', env, hasRpmDb).name).toBe(
      'EverRoad-0.1.19-linux-x86_64.AppImage',
    );
  });

  it('falls back to the AppImage where there is no rpm database to install into', () => {
    // An extracted AppImage run without its launcher, or a Debian box: handing
    // back an .rpm would be the same wrong-file bug one step over.
    expect(pickFile(LINUX_FILES, 'linux', 'x64', {}, noRpmDb).name).toBe(
      'EverRoad-0.1.19-linux-x86_64.AppImage',
    );
  });

  it('still returns something on Linux when the feed lists neither format', () => {
    const odd = [{ url: 'EverRoad-0.1.19-linux-x86_64.tar.gz', sha512: 'a' }];
    expect(pickFile(odd, 'linux', 'x64', {}, hasRpmDb).name).toBe(
      'EverRoad-0.1.19-linux-x86_64.tar.gz',
    );
  });

  it('falls back to every candidate rather than none on an unknown arch', () => {
    // A wrong-arch download whose name the user can read beats no download.
    expect(pickFile(MAC_FILES, 'darwin', 'ppc64').name).toBe('EverRoad-0.1.17-mac-x64.dmg');
  });

  it('is null when the feed named no files at all', () => {
    expect(pickFile([], 'darwin', 'arm64')).toBeNull();
    expect(pickFile(undefined, 'darwin', 'arm64')).toBeNull();
  });
});

describe('linuxPackageFormat', () => {
  it('trusts APPIMAGE, which the AppImage runtime sets itself', () => {
    expect(linuxPackageFormat({ APPIMAGE: '/tmp/EverRoad.AppImage' }, noRpmDb)).toBe('AppImage');
  });

  it('reads an install with no APPIMAGE and an rpm database as the rpm build', () => {
    expect(linuxPackageFormat({}, hasRpmDb)).toBe('rpm');
  });

  it('defaults to the AppImage, which runs anywhere, when neither signal is present', () => {
    expect(linuxPackageFormat({}, noRpmDb)).toBe('AppImage');
  });
});

describe('deliveryMode', () => {
  it('installs in place on the Windows installer build', () => {
    expect(deliveryMode('win32', {})).toBe('in-place');
  });

  it('cannot install in place from the portable .exe', () => {
    expect(deliveryMode('win32', { PORTABLE_EXECUTABLE_DIR: 'C:\\EverRoad' })).toBe('manual');
  });

  it('installs in place from an AppImage but not from the RPM', () => {
    expect(deliveryMode('linux', { APPIMAGE: '/opt/EverRoad.AppImage' })).toBe('in-place');
    expect(deliveryMode('linux', {})).toBe('manual');
  });

  it('is always manual on macOS, which is unsigned (#50)', () => {
    expect(deliveryMode('darwin', {})).toBe('manual');
  });
});
