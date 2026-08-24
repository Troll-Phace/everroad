/**
 * The two pure decisions in the updater: which artifact this machine should
 * download, and whether it can install one in place.
 *
 * Both take platform/arch as parameters rather than reading `process` directly,
 * so every combination Everroad ships can be driven from one machine — which is
 * the point, since only macOS arm64 is ever exercised by hand (#53).
 */
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// The updater is CommonJS (it is main-process code), so it is pulled in through
// a require rather than an import. It destructures `electron` at module scope,
// which outside Electron resolves to a path string — every binding comes back
// undefined and nothing throws, so the pure helpers below are reachable.
const { pickFile, deliveryMode } = createRequire(import.meta.url)('./updater.cjs');

/** The macOS feed, in the order `latest-mac.yml` actually lists it. */
const MAC_FILES = [
  { url: 'Everroad-0.1.17-mac-x64.zip', sha512: 'a' },
  { url: 'Everroad-0.1.17-mac-arm64.zip', sha512: 'b' },
  { url: 'Everroad-0.1.17-mac-x64.dmg', sha512: 'c' },
  { url: 'Everroad-0.1.17-mac-arm64.dmg', sha512: 'd' },
];

describe('pickFile', () => {
  it('does not hand an Apple Silicon machine the Intel build', () => {
    // The regression this exists for: x64 is listed first, so `files[0]` — and
    // the feed's own top-level `path` — are both the wrong binary on arm64.
    expect(pickFile(MAC_FILES, 'darwin', 'arm64').name).toBe('Everroad-0.1.17-mac-arm64.dmg');
  });

  it('picks the Intel build on an Intel Mac', () => {
    expect(pickFile(MAC_FILES, 'darwin', 'x64').name).toBe('Everroad-0.1.17-mac-x64.dmg');
  });

  it('prefers the dmg over the zip on macOS, where a human finishes the install', () => {
    const zipOnly = MAC_FILES.filter((f) => f.url.endsWith('.zip'));
    expect(pickFile(zipOnly, 'darwin', 'arm64').name).toBe('Everroad-0.1.17-mac-arm64.zip');
  });

  it('matches the linux x86_64 spelling, which does not contain "x64"', () => {
    const files = [{ url: 'Everroad-0.1.17-linux-x86_64.AppImage', sha512: 'a' }];
    expect(pickFile(files, 'linux', 'x64').name).toBe('Everroad-0.1.17-linux-x86_64.AppImage');
  });

  it('falls back to every candidate rather than none on an unknown arch', () => {
    // A wrong-arch download whose name the user can read beats no download.
    expect(pickFile(MAC_FILES, 'darwin', 'ppc64').name).toBe('Everroad-0.1.17-mac-x64.dmg');
  });

  it('is null when the feed named no files at all', () => {
    expect(pickFile([], 'darwin', 'arm64')).toBeNull();
    expect(pickFile(undefined, 'darwin', 'arm64')).toBeNull();
  });
});

describe('deliveryMode', () => {
  it('installs in place on the Windows installer build', () => {
    expect(deliveryMode('win32', {})).toBe('in-place');
  });

  it('cannot install in place from the portable .exe', () => {
    expect(deliveryMode('win32', { PORTABLE_EXECUTABLE_DIR: 'C:\\Everroad' })).toBe('manual');
  });

  it('installs in place from an AppImage but not from the RPM', () => {
    expect(deliveryMode('linux', { APPIMAGE: '/opt/Everroad.AppImage' })).toBe('in-place');
    expect(deliveryMode('linux', {})).toBe('manual');
  });

  it('is always manual on macOS, which is unsigned (#50)', () => {
    expect(deliveryMode('darwin', {})).toBe('manual');
  });
});
