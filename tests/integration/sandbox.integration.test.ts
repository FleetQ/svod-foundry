// Integration tests for the sandbox executor (ADR-0003). Needs the Docker daemon; gated behind
// RUN_INTEGRATION=1 AND a daemon-availability probe (skips gracefully otherwise).
//
// Asserts: a known-good sample passes (exit 0), and a known-malicious sample is contained across
// every in-scope vector — host write denied, undeclared egress unreachable, fork/CPU bomb bounded.

import { describe, it, expect, beforeAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Docker from 'dockerode';
import { executeInSandbox } from '../../src/sandbox/executor.js';
import { parseConfig, type Config } from '../../src/config.js';
import type { SandboxRequest } from '../../src/types.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(here, '..', 'fixtures');
const GOOD = join(FIXTURES, 'good-tool');
const MALICIOUS = join(FIXTURES, 'malicious-tool');
const EGRESS = join(FIXTURES, 'egress-tool');

const config: Config = parseConfig({ svod: { tokenRef: 'env:SVOD_TOKEN' } });
const docker = new Docker({ socketPath: config.docker.socketPath });

const enabled = process.env.RUN_INTEGRATION === '1';
let dockerUp = false;

async function pullImage(image: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    docker.pull(image, (err: Error | null, stream: NodeJS.ReadableStream) => {
      if (err) return reject(err);
      docker.modem.followProgress(stream, (e: Error | null) => (e ? reject(e) : resolve()));
    });
  });
}

beforeAll(async () => {
  if (!enabled) return;
  try {
    await docker.ping();
    dockerUp = true;
  } catch {
    dockerUp = false;
    return;
  }
  await pullImage(config.docker.baseImages.python);
  // node:22-slim is the egress-proxy sidecar image; pull it so the allowlist test can run. A pull
  // failure or stall (offline/slow registry) is non-fatal and bounded — the egress test self-skips
  // when the image is absent.
  const nodeImage = config.docker.baseImages.node;
  const alreadyHaveNode = await docker
    .getImage(nodeImage)
    .inspect()
    .then(() => true)
    .catch(() => false);
  if (!alreadyHaveNode) {
    await Promise.race([
      pullImage(nodeImage).catch(() => {}),
      new Promise<void>((resolve) => setTimeout(resolve, 60_000)),
    ]);
  }
}, 180_000);

const maybe = enabled ? describe : describe.skip;

function req(overrides: Partial<SandboxRequest>): SandboxRequest {
  return {
    toolDir: GOOD,
    runtime: 'python',
    command: ['python', '/tool/tool.py'],
    network: [],
    limits: { memory: '256m', cpus: 1, pidsLimit: 64, timeoutMs: 30_000 },
    ...overrides,
  };
}

maybe('sandbox executor (integration)', () => {
  it('runs the known-good sample to a clean exit 0', async ({ skip }) => {
    if (!dockerUp) return skip();
    const result = await executeInSandbox(
      req({ toolDir: GOOD, command: ['python', '/tool/tool.py', '--selftest'] }),
      config,
    );
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('good-tool selftest OK');
  });

  it('runs the known-good sample with arguments (run path)', async ({ skip }) => {
    if (!dockerUp) return skip();
    const result = await executeInSandbox(
      req({ toolDir: GOOD, command: ['python', '/tool/tool.py', '40', '2'] }),
      config,
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('42');
  });

  it('CONTAINS host filesystem writes (read-only mount, no writable host bind)', async ({
    skip,
  }) => {
    if (!dockerUp) return skip();
    const result = await executeInSandbox(
      req({ toolDir: MALICIOUS, command: ['python', '/tool/tool.py', '--write-host'] }),
      config,
    );
    // exit 0 == every host-write attempt was denied (see fixture's exit-code contract).
    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain('CONTAINMENT FAILURE');
    expect(result.stderr).toContain('denied write');
  });

  it('CONTAINS undeclared egress (NetworkMode none)', async ({ skip }) => {
    if (!dockerUp) return skip();
    const result = await executeInSandbox(
      req({ toolDir: MALICIOUS, network: [], command: ['python', '/tool/tool.py', '--exfil'] }),
      config,
    );
    // exit 0 == the outbound connection was refused.
    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain('CONTAINMENT FAILURE');
    expect(result.stderr).toContain('egress denied');
  });

  it('BOUNDS a fork bomb via the pids-limit', async ({ skip }) => {
    if (!dockerUp) return skip();
    const result = await executeInSandbox(
      req({
        toolDir: MALICIOUS,
        command: ['python', '/tool/tool.py', '--forkbomb'],
        limits: { memory: '256m', cpus: 1, pidsLimit: 32, timeoutMs: 25_000 },
      }),
      config,
    );
    // The host stays healthy and the run terminates (either fork() was denied => exit 13, or the
    // wall-clock timeout fired). It must NOT run unbounded.
    expect(result.exitCode !== 0 || result.timedOut).toBe(true);
  });

  it('BOUNDS an infinite CPU spin via the wall-clock timeout', async ({ skip }) => {
    if (!dockerUp) return skip();
    const start = Date.now();
    const result = await executeInSandbox(
      req({
        toolDir: MALICIOUS,
        command: ['python', '/tool/tool.py', '--spin'],
        limits: { memory: '256m', cpus: 1, pidsLimit: 32, timeoutMs: 5_000 },
      }),
      config,
    );
    const elapsed = Date.now() - start;
    expect(result.timedOut).toBe(true);
    // It was killed near the timeout, not allowed to run away.
    expect(elapsed).toBeLessThan(20_000);
  });

  it('routes allowlisted egress through the proxy and BLOCKS everything else', async ({ skip }) => {
    if (!dockerUp) return skip();
    // The proxy sidecar runs from the node base image; skip cleanly if it could not be pulled.
    try {
      await docker.getImage(config.docker.baseImages.node).inspect();
    } catch {
      return skip();
    }
    const result = await executeInSandbox(
      req({
        toolDir: EGRESS,
        network: ['example.com'],
        command: ['python', '/tool/tool.py', 'example.com', 'example.org'],
        limits: { memory: '256m', cpus: 1, pidsLimit: 64, timeoutMs: 30_000 },
      }),
      config,
    );

    const blocked = /^BLOCKED .* (ERR:|403|502)/m.test(result.stdout);
    const allowedReachable = /^ALLOWED example\.com \d{3}$/m.test(result.stdout);

    // The non-allowlisted host MUST be refused by the proxy — this is the airtight invariant and
    // does not depend on outbound internet.
    expect(blocked).toBe(true);

    // The allowlisted host should be reachable through the proxy. If this environment has no
    // outbound internet at all, skip that half rather than fail (the block half already proved the
    // allowlist is enforced).
    if (!allowedReachable && /ALLOWED example\.com ERR:URLError/m.test(result.stdout)) {
      return skip();
    }
    expect(allowedReachable).toBe(true);
  });
});
