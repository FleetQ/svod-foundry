# Contributing to Svod Foundry

Thanks for your interest. Svod Foundry is a small, safety-critical component, so the contribution
bar is "every change keeps the suite green and the sandbox airtight."

## Ground rules

- **Apache-2.0.** By contributing you agree your work is licensed under the project's
  [LICENSE](LICENSE).
- **English** for all code, comments, docs, and commit messages. Source files are **UTF-8** and
  must stay Cyrillic-safe (no encoding assumptions that break non-ASCII text in tool I/O).
- **Docker over local installs.** Anything that runs tool code or the integration stack goes
  through Docker, not a host-local interpreter.
- **ADR discipline.** Any significant or hard-to-reverse decision (a new dependency, a change to
  the sandbox contract, a new artifact-format assumption) gets a short ADR under
  [`docs/adr/`](docs/adr/) before or with the change. Number them sequentially.
- **Respect the boundaries.** Do not merge anything into the Svod engine, do not vendor it, and do
  not couple the foundry to FleetQ. Svod is the store of record — do not build parallel
  persistence, lifecycle, audit, or recall.

## Development setup

```bash
npm install
npm run build
npm run lint
npm test                 # unit tests (no Docker / no network)
docker compose up -d     # bring up Svod + foundry for integration tests
npm run test:integration # requires Docker + a live Svod
```

## What CI gates (every change)

The GitHub Actions workflow runs on every push/PR and must be green to merge:

1. **Lint** — `npm run lint` (ESLint, flat config).
2. **Typecheck** — `npm run typecheck` (`tsc --noEmit`).
3. **Unit tests** — `npm test` (Vitest, no Docker, no network).
4. **Integration tests** — `npm run test:integration`, against a live Svod engine and the Docker
   daemon brought up via `docker compose`.

A change that touches the sandbox MUST keep the known-good sample passing **and** the
known-malicious sample contained/denied. A change that touches the Svod client MUST preserve
optimistic-concurrency behavior (a stale write returns a `conflict`, never a silent overwrite).

## Coding conventions

- TypeScript, ESM, `strict` mode. No `any` in `src/` without a written reason.
- Keep the `verify` and `run` code paths identical — do not fork them.
- Validate at boundaries (MCP tool inputs, config). Trust internal calls.
- Don't gold-plate: implement what the task needs, not hypothetical futures.

## Commit and PR hygiene

- Small, logically-scoped commits with imperative subjects.
- Reference the milestone or ADR a change belongs to where it helps.
- Describe, in the PR, how you verified the change (which suites you ran, and on what).
