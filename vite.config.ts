import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset URLs, so the build works from any path: GitHub Pages serves it
  // under /umastudio/.
  base: './',
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
