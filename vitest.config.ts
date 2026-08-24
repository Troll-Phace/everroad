import { defineConfig } from 'vitest/config';
import { buildDefines } from './scripts/lib/build-info.mjs';

export default defineConfig({
  // The same compile-time stamp vite.config.ts injects, so src/version/ is
  // testable without stubbing globals.
  define: buildDefines(),
  test: {
    environment: 'node',
    include: [
      'src/**/*.test.ts',
      'scripts/**/*.test.mjs',
      'scripts/**/*.test.ts',
      'electron/**/*.test.ts',
    ],
  },
});
