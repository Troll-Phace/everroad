import { defineConfig } from 'vite';
import { buildDefines } from './scripts/lib/build-info.mjs';

export default defineConfig({
  // Relative asset URLs. Required for the Electron build, which loads
  // dist/index.html over file:// where a root-absolute "/assets/..." would
  // resolve against the filesystem root. Harmless for the web build.
  base: './',
  // ARCHITECTURE.md §15 fixes the dev port at 5199, strict: the Browser pane's
  // launch config trusts it, so a silent fallback to another port breaks the
  // preview harness rather than degrading gracefully.
  server: {
    port: 5199,
    strictPort: true,
  },
  // §15 fixes the *dev* port only. Vite would otherwise inherit the strictness
  // here, turning a busy 4173 into a hard failure for a port nobody pinned.
  preview: {
    strictPort: false,
  },
  // Compile-time build stamp read by src/version/version.ts (§16). Mirrored in
  // vitest.config.ts so tests see the same constants.
  define: buildDefines(),
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
});
