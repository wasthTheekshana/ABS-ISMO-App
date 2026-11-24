import { defineConfig } from 'vitest/config';

// Backend integration tests only. Runs against a throw-away `isoms_test` database that
// globalSetup drops/recreates — it refuses to run against any DB not ending in `_test`.
export default defineConfig({
  test: {
    include: ['server/tests/**/*.test.js'],
    environment: 'node',
    globalSetup: ['server/tests/globalSetup.js'],
    setupFiles: ['server/tests/setupEnv.js'],
    fileParallelism: false, // all files share one test DB
    testTimeout: 30000,
    hookTimeout: 60000
  }
});
