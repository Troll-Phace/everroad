/// <reference types="vite/client" />

/**
 * Compile-time build stamp, substituted by Vite's `define` (see
 * `scripts/lib/build-info.mjs`, wired into both `vite.config.ts` and
 * `vitest.config.ts`). Declared here so `tsc --noEmit` sees them; only
 * `src/version/version.ts` should read them directly.
 */
declare const __APP_VERSION__: string;
declare const __BUILD_COMMIT__: string;
declare const __BUILD_DATE__: string;
