# Integration tests

`*.integration.test.ts` here run via `npm run test:integration` (gated by `RUN_INTEGRATION=1`).

- `sandbox.integration.test.ts` (M3) — needs only the Docker daemon. Asserts a known-good sample
  passes and a known-malicious sample is contained/denied (no host write, no undeclared egress, no
  resource exhaustion).
- `svod.integration.test.ts` (M2) — needs a live Svod engine (`docker compose up -d svod`). Asserts
  write/read/promote round-trips and optimistic-concurrency conflict handling.

Fixtures (sample skills/scripts) live in `../fixtures/`.
