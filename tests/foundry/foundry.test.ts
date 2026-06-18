import { describe, it, expect, vi } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { Foundry, type SvodLike, type ExecuteFn } from '../../src/foundry/index.js';
import { SvodConflictError } from '../../src/svod/index.js';
import type { SvodNote, ReadParams, WriteParams, PromoteParams } from '../../src/svod/index.js';
import { parseConfig, type Config } from '../../src/config.js';
import type { SandboxRequest, SandboxResult } from '../../src/types.js';

const config: Config = parseConfig({ svod: { tokenRef: 'env:T' } });

/** In-memory Svod double: store keyed by path, with Svod's optimistic-concurrency semantics. */
class FakeSvod implements SvodLike {
  store = new Map<string, { content: string; revision: string }>();
  tools: SvodNote[] = [];
  private n = 0;
  private nextRev(): string {
    this.n += 1;
    return `r${this.n}`;
  }
  async recallTools(): Promise<SvodNote[]> {
    return this.tools;
  }
  async read(params: ReadParams) {
    const e = this.store.get(params.path);
    if (!e) throw new Error(`not found: ${params.path}`);
    return { path: params.path, content: e.content, revision: e.revision };
  }
  async write(params: WriteParams) {
    const existing = this.store.get(params.path);
    if (existing && params.expectedRevision !== existing.revision) {
      throw new SvodConflictError({
        path: params.path,
        currentRevision: existing.revision,
        currentContent: existing.content,
      });
    }
    const revision = this.nextRev();
    this.store.set(params.path, { content: params.content, revision });
    return { ok: true as const, path: params.path, revision };
  }
  async promote(params: PromoteParams) {
    // Svod's promote is a per-note move: from -> to, revision-checked.
    const existing = this.store.get(params.from);
    if (!existing) throw new Error(`promote: not found ${params.from}`);
    if (params.expectedRevision !== undefined && params.expectedRevision !== existing.revision) {
      throw new SvodConflictError({
        path: params.from,
        currentRevision: existing.revision,
        currentContent: existing.content,
      });
    }
    this.store.delete(params.from);
    const revision = this.nextRev();
    this.store.set(params.to, { content: existing.content, revision });
    return { path: params.to, revision, status: 'active' as const };
  }
}

function okSpec(overrides: Record<string, unknown> = {}) {
  return { name: 'adder', description: 'adds two ints', runtime: 'python', script: 'print(1)', ...overrides };
}

/** A fake executor returning a fixed result, capturing the request it was given. */
function fakeExecutor(result: Partial<SandboxResult>): ExecuteFn & { calls: SandboxRequest[] } {
  const calls: SandboxRequest[] = [];
  const fn = (async (request: SandboxRequest) => {
    calls.push(request);
    return { exitCode: 0, stdout: '', stderr: '', timedOut: false, ...result };
  }) as ExecuteFn & { calls: SandboxRequest[] };
  fn.calls = calls;
  return fn;
}

describe('synthesize', () => {
  it('writes a provisional draft (SKILL.md + script) and does not run anything', async () => {
    const svod = new FakeSvod();
    const execute = fakeExecutor({});
    const foundry = new Foundry({ svod, config, execute });

    const res = await foundry.synthesize(okSpec());
    expect(res.skipped).toBe(false);
    expect(res.name).toBe('adder');
    expect(res.revision).toBeTruthy();
    expect(svod.store.has('messy/tools/adder/SKILL.md')).toBe(true);
    expect(svod.store.has('messy/tools/adder/tool.py')).toBe(true);
    expect(execute.calls).toHaveLength(0); // synthesize never executes
  });

  it('recall-skips when an ACTIVE tool of the same name already exists', async () => {
    const svod = new FakeSvod();
    svod.tools = [{ path: 'vault/tools/adder/SKILL.md', revision: 'rX', status: 'active' }];
    const foundry = new Foundry({ svod, config, execute: fakeExecutor({}) });

    const res = await foundry.synthesize(okSpec());
    expect(res.skipped).toBe(true);
    expect(res.revision).toBe('rX');
    expect(svod.store.size).toBe(0); // nothing written
  });

  it('does NOT skip when a same-name tool exists only as provisional', async () => {
    const svod = new FakeSvod();
    svod.tools = [{ path: 'messy/tools/adder/SKILL.md', revision: 'rX', status: 'provisional' }];
    const foundry = new Foundry({ svod, config, execute: fakeExecutor({}) });
    const res = await foundry.synthesize(okSpec());
    expect(res.skipped).toBe(false);
  });

  it('re-synthesis over an existing draft updates via the conflict path (no blind overwrite)', async () => {
    const svod = new FakeSvod();
    const foundry = new Foundry({ svod, config, execute: fakeExecutor({}) });
    await foundry.synthesize(okSpec({ script: 'print("v1")' }));
    const before = svod.store.get('messy/tools/adder/tool.py')!.revision;

    const res = await foundry.synthesize(okSpec({ script: 'print("v2")' }));
    expect(res.skipped).toBe(false);
    expect(svod.store.get('messy/tools/adder/tool.py')!.content).toContain('v2');
    expect(svod.store.get('messy/tools/adder/tool.py')!.revision).not.toBe(before);
  });

  it('rejects an invalid spec (literal secret, non-kebab name)', async () => {
    const foundry = new Foundry({ svod: new FakeSvod(), config, execute: fakeExecutor({}) });
    await expect(foundry.synthesize(okSpec({ secrets: ['hunter2'] }))).rejects.toThrow();
    await expect(foundry.synthesize(okSpec({ name: 'Not Kebab' }))).rejects.toThrow();
  });
});

/** Seed a provisional tool into the fake store so verify/run/promote can read it. */
async function seedTool(svod: FakeSvod, execute: ExecuteFn, overrides: Record<string, unknown> = {}) {
  const foundry = new Foundry({ svod, config, execute });
  await foundry.synthesize(okSpec(overrides));
  return foundry;
}

describe('verify', () => {
  it('passes on exit 0 and maps the sandbox result', async () => {
    const svod = new FakeSvod();
    const execute = fakeExecutor({ exitCode: 0, stdout: 'ok' });
    const foundry = await seedTool(svod, execute);

    const v = await foundry.verify('adder');
    expect(v.pass).toBe(true);
    expect(v.exitCode).toBe(0);
    expect(v.stdout).toBe('ok');
    // It ran the self-test command in the sandbox, against a materialized tool dir.
    const req = execute.calls.at(-1)!;
    expect(req.command).toEqual(['python', '/tool/tool.py', '--selftest']);
    expect(req.runtime).toBe('python');
    expect(req.network).toEqual([]);
    expect(req.limits).toEqual(config.limits);
  });

  it('materializes the script into the (read-only-mounted) tool dir before running', async () => {
    const svod = new FakeSvod();
    let scriptSeenOnDisk = false;
    const execute: ExecuteFn = async (request) => {
      scriptSeenOnDisk = existsSync(join(request.toolDir, 'tool.py'));
      const body = readFileSync(join(request.toolDir, 'tool.py'), 'utf8');
      expect(body).toContain('print');
      return { exitCode: 0, stdout: '', stderr: '', timedOut: false };
    };
    const foundry = await seedTool(svod, execute);
    await foundry.verify('adder');
    expect(scriptSeenOnDisk).toBe(true);
  });

  it('fails on a non-zero exit and on a timeout', async () => {
    const svod = new FakeSvod();
    const foundry = await seedTool(svod, fakeExecutor({ exitCode: 1, stderr: 'boom' }));
    const v = await foundry.verify('adder');
    expect(v.pass).toBe(false);
    expect(v.stderr).toBe('boom');

    const svod2 = new FakeSvod();
    const foundry2 = await seedTool(svod2, fakeExecutor({ exitCode: 0, timedOut: true }));
    expect((await foundry2.verify('adder')).pass).toBe(false);
  });
});

describe('run', () => {
  it('executes the entry command with args through the sandbox', async () => {
    const svod = new FakeSvod();
    const execute = fakeExecutor({ exitCode: 0, stdout: '42' });
    const foundry = await seedTool(svod, execute);

    const r = await foundry.run('adder', ['40', '2']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('42');
    expect(execute.calls.at(-1)!.command).toEqual(['python', '/tool/tool.py', '40', '2']);
  });

  it('resolves a tool that lives only in vault (active)', async () => {
    const svod = new FakeSvod();
    const execute = fakeExecutor({ exitCode: 0 });
    const foundry = await seedTool(svod, execute);
    // Promote it to vault, then run must still find it.
    await foundry.promote('adder');
    const r = await foundry.run('adder', []);
    expect(r.exitCode).toBe(0);
  });
});

describe('promote', () => {
  it('refuses to promote on a red verify (no Svod move)', async () => {
    const svod = new FakeSvod();
    const promoteSpy = vi.spyOn(svod, 'promote');
    const foundry = await seedTool(svod, fakeExecutor({ exitCode: 1 }));

    const out = await foundry.promote('adder');
    expect(out.promoted).toBe(false);
    expect(out.verify.pass).toBe(false);
    expect(promoteSpy).not.toHaveBeenCalled();
    expect(svod.store.has('messy/tools/adder/SKILL.md')).toBe(true); // still in messy
  });

  it('promotes on a green verify (messy -> vault, status active)', async () => {
    const svod = new FakeSvod();
    const foundry = await seedTool(svod, fakeExecutor({ exitCode: 0 }));

    const out = await foundry.promote('adder');
    expect(out.promoted).toBe(true);
    expect(out.verify.pass).toBe(true);
    expect(out.status).toBe('active');
    expect(out.path).toBe('vault/tools/adder/SKILL.md');
    // Both notes moved to vault; messy is empty; the promoted SKILL.md is now status: active.
    expect(svod.store.has('vault/tools/adder/SKILL.md')).toBe(true);
    expect(svod.store.has('vault/tools/adder/tool.py')).toBe(true);
    expect(svod.store.has('messy/tools/adder/SKILL.md')).toBe(false);
    expect(svod.store.has('messy/tools/adder/tool.py')).toBe(false);
    expect(svod.store.get('vault/tools/adder/SKILL.md')!.content).toContain('status: active');
  });
});
