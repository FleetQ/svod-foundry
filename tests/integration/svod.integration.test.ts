// Svod MCP client integration test (M2).
//
// Exercises write -> read -> promote and a forced optimistic-concurrency conflict against a LIVE
// Svod engine (default http://127.0.0.1:7518/mcp, `docker compose up -d svod`).
//
// Gated: skips gracefully when RUN_INTEGRATION is unset OR when Svod is unreachable, so a plain
// environment without a running engine never fails. Set SVOD_TOKEN (a WRITE-role bearer token) and,
// optionally, SVOD_ENDPOINT to point at a non-default engine.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { parseConfig, type Config } from '../../src/config.js';
import { SvodClient, SvodConflictError } from '../../src/svod/index.js';

const RUN = process.env.RUN_INTEGRATION === '1';
const ENDPOINT = process.env.SVOD_ENDPOINT ?? 'http://127.0.0.1:7518/mcp';
const TOKEN_REF = process.env.SVOD_TOKEN ? 'env:SVOD_TOKEN' : undefined;

/** Probe Svod's MCP endpoint over HTTP; returns true if something answers (any status). */
async function svodReachable(): Promise<boolean> {
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 2000);
    await fetch(ENDPOINT, { method: 'GET', signal: ac.signal }).finally(() => clearTimeout(timer));
    return true;
  } catch {
    return false;
  }
}

let live = false;
let client: SvodClient | undefined;
let config: Config | undefined;

beforeAll(async () => {
  if (!RUN || !TOKEN_REF) return;
  if (!(await svodReachable())) return;
  config = parseConfig({ svod: { tokenRef: TOKEN_REF, endpoint: ENDPOINT } });
  client = new SvodClient(config);
  try {
    await client.connect();
    live = true;
  } catch {
    live = false;
  }
});

afterAll(async () => {
  if (client && live) await client.close();
});

describe.runIf(RUN)('SvodClient against a live engine', () => {
  it('round-trips write -> read -> promote and forces a conflict', async ({ skip }) => {
    if (!live || !client) {
      skip();
      return;
    }
    const name = `it-${Date.now()}`;
    const messyPath = `messy/tools/${name}/SKILL.md`;
    const body = `---\nname: ${name}\ntype: tool\nstatus: provisional\n---\nintegration probe\n`;

    // write (create)
    const created = await client.write({ path: messyPath, content: body });
    expect(created.ok).toBe(true);
    expect(created.revision).toBeTruthy();

    // read back
    const readBack = await client.read({ path: messyPath });
    expect(readBack.content).toContain('integration probe');
    expect(readBack.revision).toBe(created.revision);

    // forced optimistic-concurrency conflict: write with a stale expectedRevision
    const conflict = await client
      .write({ path: messyPath, content: body + 'stale\n', expectedRevision: 'definitely-stale' })
      .catch((e: unknown) => e);
    expect(conflict).toBeInstanceOf(SvodConflictError);
    expect((conflict as SvodConflictError).currentRevision).toBeTruthy();

    // promote messy -> vault at the current revision
    const promoted = await client.promote({ path: messyPath, expectedRevision: readBack.revision });
    expect(promoted.status).toBe('active');
    expect(promoted.path).toContain('vault/tools/');
  });
});
