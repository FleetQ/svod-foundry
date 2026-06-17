import { defineConfig } from 'vitest/config';

// Unit test config. Integration tests (*.integration.test.ts) are excluded here and
// run separately via `npm run test:integration` (they need Docker + a live Svod).
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/**/*.integration.test.ts', 'node_modules/**', 'dist/**'],
    environment: 'node',
    testTimeout: 20_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts'],
    },
  },
});
