/**
 * Build identity: which version of Everroad this is, where it came from, and
 * which of the two runtimes it is running in.
 *
 * The three constants are compile-time substitutions (`vite.config.ts` ->
 * `scripts/lib/build-info.mjs`), not runtime lookups, so reading them costs
 * nothing and they cannot drift from the bundle they are baked into.
 *
 * Leaf module — imports nothing from the game (ARCHITECTURE.md §3.4).
 */
import { desktop } from './desktop';

/** Semantic version of this build, taken from package.json at build time. */
export const APP_VERSION: string = __APP_VERSION__;

/** Short commit sha this build came from, or `'dev'` outside a repository. */
export const BUILD_COMMIT: string = __BUILD_COMMIT__;

/** ISO 8601 date (YYYY-MM-DD) of the commit this build came from. */
export const BUILD_DATE: string = __BUILD_DATE__;

/**
 * The two shipping surfaces: the Electron desktop app published to GitHub
 * Releases, and the browser build that development runs against (§16).
 */
export type Runtime = 'desktop' | 'web';

/**
 * Which runtime this build is executing in, decided solely by whether the
 * preload bridge is present. There is no build-time flag: one bundle serves
 * both, and the desktop wrapper is additive.
 */
export function runtime(): Runtime {
  return desktop() !== null ? 'desktop' : 'web';
}

/** Convenience predicate for the desktop-only affordances (Quit to Desktop). */
export function isDesktop(): boolean {
  return runtime() === 'desktop';
}

/**
 * One-line build identity for the menu corner, the settings panel, and bug
 * reports: `v0.1.17 · desktop · a1b2c3d`.
 */
export function buildLabel(): string {
  return `v${APP_VERSION} · ${runtime()} · ${BUILD_COMMIT}`;
}
