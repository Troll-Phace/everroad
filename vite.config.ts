import { defineConfig } from 'vite';

export default defineConfig({
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
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
});
