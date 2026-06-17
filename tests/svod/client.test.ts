import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseConfig, type Config } from '../../src/config.js';
import {
  SvodClient,
  SvodConflictError,
  SvodToolError,
  SvodParseError,
  type McpClientLike,
} from '../../src/svod/index.js';

const config: Config = parseConfig({ svod: { tokenRef: 'env:SVOD_TOKEN' } });

/** Build a SvodClient backed by a stubbed callTool, returning both for assertions. */
function makeClient(callTool: McpClientLike['callTool']) {
  const fake: McpClientLike = {
    connect: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    callTool,
  };
  const client = new SvodClient(config, { client: fake });
  return { client, fake };
}

/** Wrap a JSON payload the way Svod does: a single text content block. */
function textResult(payload: unknown, extra: Record<string, unknown> = {}) {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }], ...extra };
}

describe('SvodClient lifecycle', () => {
  it('connect/close delegate to the injected client', async () => {
    const { client, fake } = makeClient(vi.fn());
    await client.connect();
    await client.close();
    expect(fake.connect).toHaveBeenCalledOnce();
    expect(fake.close).toHaveBeenCalledOnce();
  });

  it('rejects calls before connect()', async () => {
    const { client } = makeClient(vi.fn());
    await expect(client.read({ path: 'vault/tools/x/SKILL.md' })).rejects.toBeInstanceOf(
      SvodToolError,
    );
  });
});

describe('recallTools', () => {
  it('calls context_pack with enumerate:true and a type:tool filter', async () => {
    const callTool = vi.fn(async () => textResult({ notes: [] }));
    const { client } = makeClient(callTool);
    await client.connect();
    await client.recallTools();

    expect(callTool).toHaveBeenCalledWith({
      name: 'context_pack',
      arguments: { enumerate: true, filter: { type: 'tool' } },
    });
  });

  it('adds a tags filter only when tags are supplied', async () => {
    const callTool = vi.fn(async () => textResult({ notes: [] }));
    const { client } = makeClient(callTool);
    await client.connect();
    await client.recallTools({ tags: ['csv', 'parse'] });

    expect(callTool).toHaveBeenCalledWith({
      name: 'context_pack',
      arguments: { enumerate: true, filter: { type: 'tool', tags: ['csv', 'parse'] } },
    });
  });

  it('returns notes verbatim', async () => {
    const notes = [
      { path: 'vault/tools/a/SKILL.md', revision: 'r1', type: 'tool', status: 'active' },
      { path: 'vault/tools/b/SKILL.md', revision: 'r2', type: 'tool', status: 'active' },
    ];
    const { client } = makeClient(vi.fn(async () => textResult({ notes })));
    await client.connect();
    expect(await client.recallTools()).toEqual(notes);
  });
});

describe('result parsing', () => {
  it('parses read content + revision', async () => {
    const { client } = makeClient(
      vi.fn(async () =>
        textResult({ path: 'messy/tools/x/SKILL.md', content: 'hi', revision: 'r5', status: 'provisional' }),
      ),
    );
    await client.connect();
    const r = await client.read({ path: 'messy/tools/x/SKILL.md' });
    expect(r).toEqual({
      path: 'messy/tools/x/SKILL.md',
      content: 'hi',
      revision: 'r5',
      status: 'provisional',
    });
  });

  it('accepts structuredContent when no text block is present', async () => {
    const { client } = makeClient(
      vi.fn(async () => ({ structuredContent: { path: 'p', content: 'c', revision: 'r9' } })),
    );
    await client.connect();
    expect(await client.read({ path: 'p' })).toMatchObject({ content: 'c', revision: 'r9' });
  });

  it('tolerates a bare array from search', async () => {
    const notes = [{ path: 'vault/tools/a/SKILL.md', revision: 'r1' }];
    const { client } = makeClient(vi.fn(async () => textResult(notes)));
    await client.connect();
    expect(await client.search({ query: 'csv' })).toEqual(notes);
  });

  it('throws SvodParseError on non-JSON text', async () => {
    const { client } = makeClient(vi.fn(async () => ({ content: [{ type: 'text', text: 'not json' }] })));
    await client.connect();
    await expect(client.read({ path: 'p' })).rejects.toBeInstanceOf(SvodParseError);
  });
});

describe('write — happy path', () => {
  it('drops undefined params and returns the new revision', async () => {
    const callTool = vi.fn(async () => textResult({ path: 'messy/tools/x/SKILL.md', revision: 'r2' }));
    const { client } = makeClient(callTool);
    await client.connect();
    const res = await client.write({ path: 'messy/tools/x/SKILL.md', content: 'body' });

    expect(res).toEqual({ ok: true, path: 'messy/tools/x/SKILL.md', revision: 'r2' });
    // expectedRevision was undefined -> must not appear in arguments
    expect(callTool).toHaveBeenCalledWith({
      name: 'write',
      arguments: { path: 'messy/tools/x/SKILL.md', content: 'body' },
    });
  });

  it('forwards expectedRevision when supplied', async () => {
    const callTool = vi.fn(async () => textResult({ path: 'p', revision: 'r3' }));
    const { client } = makeClient(callTool);
    await client.connect();
    await client.write({ path: 'p', content: 'b', expectedRevision: 'r2' });
    expect(callTool).toHaveBeenCalledWith({
      name: 'write',
      arguments: { path: 'p', content: 'b', expectedRevision: 'r2' },
    });
  });
});

describe('write — optimistic-concurrency conflict (critical)', () => {
  const cases: Array<{ name: string; payload: unknown }> = [
    {
      name: 'nested { conflict: { currentContent, currentRevision } }',
      payload: { conflict: { currentContent: 'newer body', currentRevision: 'r7' } },
    },
    {
      name: 'flat { conflict: true, currentContent, currentRevision }',
      payload: { conflict: true, currentContent: 'newer body', currentRevision: 'r7' },
    },
    {
      name: "{ status: 'conflict', content, revision }",
      payload: { status: 'conflict', content: 'newer body', revision: 'r7' },
    },
  ];

  for (const { name, payload } of cases) {
    it(`detects ${name} and throws SvodConflictError with current content`, async () => {
      const { client } = makeClient(vi.fn(async () => textResult(payload)));
      await client.connect();

      const err = await client
        .write({ path: 'messy/tools/x/SKILL.md', content: 'stale', expectedRevision: 'r5' })
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(SvodConflictError);
      const conflict = err as SvodConflictError;
      expect(conflict.path).toBe('messy/tools/x/SKILL.md');
      expect(conflict.currentRevision).toBe('r7');
      expect(conflict.currentContent).toBe('newer body');
    });
  }

  it('still surfaces a conflict even when the server flags isError:true', async () => {
    const { client } = makeClient(
      vi.fn(async () =>
        textResult({ conflict: { currentContent: 'x', currentRevision: 'r9' } }, { isError: true }),
      ),
    );
    await client.connect();
    await expect(
      client.write({ path: 'p', content: 'c', expectedRevision: 'r1' }),
    ).rejects.toBeInstanceOf(SvodConflictError);
  });
});

describe('error propagation', () => {
  it('maps a non-conflict isError result to SvodToolError', async () => {
    const { client } = makeClient(
      vi.fn(async () => textResult({ error: 'permission denied' }, { isError: true })),
    );
    await client.connect();
    await expect(client.write({ path: 'p', content: 'c' })).rejects.toThrowError(/permission denied/);
  });

  it('propagates a thrown transport/protocol error from callTool', async () => {
    const { client } = makeClient(
      vi.fn(async () => {
        throw new Error('boom: connection reset');
      }),
    );
    await client.connect();
    await expect(client.read({ path: 'p' })).rejects.toThrowError(/boom/);
  });
});

describe('promote', () => {
  it('returns the vault path + active status', async () => {
    const { client } = makeClient(
      vi.fn(async () => textResult({ path: 'vault/tools/x/SKILL.md', revision: 'r4', status: 'active' })),
    );
    await client.connect();
    const res = await client.promote({ path: 'messy/tools/x/SKILL.md', expectedRevision: 'r3' });
    expect(res).toEqual({ path: 'vault/tools/x/SKILL.md', revision: 'r4', status: 'active' });
  });

  it('throws SvodConflictError on a stale promote', async () => {
    const { client } = makeClient(
      vi.fn(async () => textResult({ conflict: { currentRevision: 'r8', currentContent: 'c' } })),
    );
    await client.connect();
    await expect(
      client.promote({ path: 'messy/tools/x/SKILL.md', expectedRevision: 'r3' }),
    ).rejects.toBeInstanceOf(SvodConflictError);
  });
});

describe('history & diff', () => {
  beforeEach(() => {
    delete process.env.SVOD_TOKEN;
  });

  it('parses history entries', async () => {
    const entries = [{ revision: 'r2', author: 'agent-7', timestamp: '2026-06-18T00:00:00Z' }];
    const { client } = makeClient(vi.fn(async () => textResult({ path: 'p', entries })));
    await client.connect();
    expect(await client.history({ path: 'p' })).toEqual({ path: 'p', entries });
  });

  it('parses a diff', async () => {
    const { client } = makeClient(
      vi.fn(async () => textResult({ path: 'p', from: 'r1', to: 'r2', diff: '@@ -1 +1 @@' })),
    );
    await client.connect();
    expect(await client.diff({ path: 'p', from: 'r1', to: 'r2' })).toEqual({
      path: 'p',
      from: 'r1',
      to: 'r2',
      diff: '@@ -1 +1 @@',
    });
  });
});
