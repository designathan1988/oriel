import { defineConfig } from 'vitest/config';

// Performance gate (npm run perf:gate): one worker, so the times are not shared with other tests.
export default defineConfig({
  test: {
    root: '.',
    include: ['test/perf/**/*.perf.ts'],
    environment: 'node',
    pool: 'forks',
    maxWorkers: 1,
    testTimeout: 120_000,
  },
});
