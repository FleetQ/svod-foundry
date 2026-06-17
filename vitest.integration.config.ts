import { defineConfig } from 'vitest/config';

// Integration test config. These tests require Docker (sandbox) and/or a live Svod
// engine (via docker-compose). They are gated behind RUN_INTEGRATION=1 so a plain
// `npm test` never tries to reach the network or the Docker daemon.
export default defineConfig({
  test: {
    include: ['tests/**/*.integration.test.ts'],
    environment: 'node',
    // Sandbox container pulls + Svod round-trips are slow; give them room.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    // Containers and the single-writer Svod engine do not like parallel hammering.
    fileParallelism: false,
  },
});
