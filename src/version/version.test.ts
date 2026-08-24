import { afterEach, describe, expect, it, vi } from 'vitest';
import { APP_VERSION, BUILD_COMMIT, BUILD_DATE, buildLabel, isDesktop, runtime } from './version';
import { desktop } from './desktop';

/** A well-formed bridge, matching what electron/preload.cjs exposes. */
const bridge = () => ({ version: '9.9.9', platform: 'darwin', quit: () => {} });

afterEach(() => vi.unstubAllGlobals());

describe('build constants', () => {
  it('carries the package version, a commit and an ISO date from Vite define', () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+/);
    expect(BUILD_COMMIT).toMatch(/^[0-9a-f]{7}$|^dev$/);
    expect(BUILD_DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('desktop', () => {
  it('is null with no window at all (the vitest node environment)', () => {
    expect(desktop()).toBeNull();
  });

  it('is null in a browser with no bridge', () => {
    vi.stubGlobal('window', {});
    expect(desktop()).toBeNull();
  });

  it('returns the bridge when the preload exposed a complete one', () => {
    const everroad = bridge();
    vi.stubGlobal('window', { everroad });
    expect(desktop()).toBe(everroad);
  });

  it.each([
    ['a missing quit', { version: '1.0.0', platform: 'linux' }],
    ['a non-string version', { version: 1, platform: 'linux', quit: () => {} }],
    ['a non-string platform', { version: '1.0.0', platform: null, quit: () => {} }],
    ['a non-object squatter', 'everroad'],
  ])('rejects %s rather than half-trusting it', (_label, everroad) => {
    vi.stubGlobal('window', { everroad });
    expect(desktop()).toBeNull();
  });
});

describe('runtime', () => {
  it('is web when the bridge is absent', () => {
    vi.stubGlobal('window', {});
    expect(runtime()).toBe('web');
    expect(isDesktop()).toBe(false);
  });

  it('is desktop when the bridge is present', () => {
    vi.stubGlobal('window', { everroad: bridge() });
    expect(runtime()).toBe('desktop');
    expect(isDesktop()).toBe(true);
  });
});

describe('buildLabel', () => {
  it('reads "v<version> · <runtime> · <commit>"', () => {
    vi.stubGlobal('window', {});
    expect(buildLabel()).toBe(`v${APP_VERSION} · web · ${BUILD_COMMIT}`);
  });

  it('names the desktop runtime when the bridge is present', () => {
    vi.stubGlobal('window', { everroad: bridge() });
    expect(buildLabel()).toBe(`v${APP_VERSION} · desktop · ${BUILD_COMMIT}`);
  });
});
