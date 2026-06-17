// End-to-end integration test for the foundry loop (Milestone 4): synthesize -> verify -> run ->
// promote, against a LIVE Svod engine (store of record) and the Docker daemon (sandbox).
//
// Gated behind RUN_INTEGRATION=1 AND reachability probes for BOTH Svod and Docker — skips cleanly
// when either is absent (e.g. no Svod engine in this environment). Bring the stack up with
// `docker compose up -d` before running.

import { describe, it, expect, beforeAll } from 'vitest';
import Docker from 'dockerode';

import { parseConfig, type Config } from '../../src/config.js';
import { SvodClient } from '../../src/svod/index.js';
import { Foundry } from '../../src/foundry/index.js';

const enabled = process.env.RUN_INTEGRATION === '1';

const config: Config = parseConfig({
  svod: { tokenRef: process.env.SVOD_FOUNDRY_TOKEN ? 'env:SVOD_FOUNDRY_TOKEN' : 'env:SVOD_TOKEN' },
  limits: { memory: '256m', cpus: 1, pidsLimit: 64, timeoutMs: 30_000 },
});

let svod: SvodClient | undefined;
let foundry: Foundry | undefined;
let ready = false;

// A trivial, well-behaved python tool: sums two ints; --selftest is deterministic.
const SCRIPT = [
  'import sys',
  'def add(a, b): return a + b',
  'if "--selftest" in sys.argv:',
  '    assert add(2, 3) == 5',
  '    print("selftest OK")',
  '    sys.exit(0)',
  'print(add(int(sys.argv[1]), int(sys.argv[2])))',
].join('\n');

beforeAll(async () => {
  if (!enabled) return;
  // Docker must be up for the sandbox.
  try {
    await new Docker({ socketPath: config.docker.socketPath }).ping();
  } catch {
    return;
  }
  // Svod must be reachable for the store of record.
  try {
    svod = new SvodClient(config);
    await svod.connect();
    foundry = new Foundry({ svod, config });
    ready = true;
  } catch {
    ready = false;
  }
}, 120_000);

const maybe = enabled ? describe : describe.skip;

maybe('foundry end-to-end (integration)', () => {
  const name = 'it-adder';

  it('synthesize -> verify -> run -> promote -> recall', async ({ skip }) => {
    if (!ready || !foundry || !svod) return skip();

    // synthesize: writes a provisional draft to Svod (no execution).
    const syn = await foundry.synthesize({
      name,
      description: 'integration sample: sums two integers',
      runtime: 'python',
      script: SCRIPT,
      tags: ['integration', 'sample'],
    });
    expect(syn.skipped).toBe(false);
    expect(syn.revision).toBeTruthy();

    // verify: runs the self-test in the sandbox.
    const verified = await foundry.verify(name);
    expect(verified.pass).toBe(true);
    expect(verified.stdout).toContain('selftest OK');

    // run: executes against args through the identical sandbox path.
    const ran = await foundry.run(name, ['40', '2']);
    expect(ran.exitCode).toBe(0);
    expect(ran.stdout.trim()).toBe('42');

    // promote: only on a green verify; moves messy/ -> vault/, status active.
    const promoted = await foundry.promote(name);
    expect(promoted.promoted).toBe(true);
    expect(promoted.status).toBe('active');

    // recall: the active tool registry now contains it.
    const tools = await svod.recallTools();
    expect(tools.some((t) => t.path.includes(`tools/${name}/`))).toBe(true);
  });
});
