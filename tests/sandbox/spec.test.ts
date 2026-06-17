// Unit tests for the pure sandbox spec helpers (ADR-0003). No Docker daemon required — these
// assert the container-create spec carries every containment control.

import { describe, it, expect } from 'vitest';
import {
  parseMemoryToBytes,
  cpusToNanoCpus,
  isNetworkDenied,
  baseImageFor,
  buildSandboxCreateOptions,
  buildHostConfig,
  buildProxyCreateOptions,
  TOOL_MOUNT,
  WORK_DIR,
} from '../../src/sandbox/spec.js';
import { parseConfig, type Config } from '../../src/config.js';
import type { SandboxRequest } from '../../src/types.js';

const config: Config = parseConfig({ svod: { tokenRef: 'env:SVOD_TOKEN' } });

function request(overrides: Partial<SandboxRequest> = {}): SandboxRequest {
  return {
    toolDir: '/abs/tools/demo',
    runtime: 'python',
    command: ['python', 'tool.py', '--selftest'],
    network: [],
    limits: { memory: '256m', cpus: 1, pidsLimit: 128, timeoutMs: 30_000 },
    ...overrides,
  };
}

describe('parseMemoryToBytes', () => {
  it('parses unit suffixes', () => {
    expect(parseMemoryToBytes('256m')).toBe(256 * 1024 * 1024);
    expect(parseMemoryToBytes('1g')).toBe(1024 ** 3);
    expect(parseMemoryToBytes('512k')).toBe(512 * 1024);
    expect(parseMemoryToBytes('1048576b')).toBe(1048576);
    expect(parseMemoryToBytes('1048576')).toBe(1048576);
  });

  it('is case-insensitive and tolerates whitespace', () => {
    expect(parseMemoryToBytes('256M')).toBe(256 * 1024 * 1024);
    expect(parseMemoryToBytes(' 1G ')).toBe(1024 ** 3);
  });

  it('throws on malformed values', () => {
    expect(() => parseMemoryToBytes('lots')).toThrow();
    expect(() => parseMemoryToBytes('')).toThrow();
    expect(() => parseMemoryToBytes('10mb')).toThrow();
  });
});

describe('cpusToNanoCpus', () => {
  it('converts fractional cores to nanocpus', () => {
    expect(cpusToNanoCpus(1)).toBe(1e9);
    expect(cpusToNanoCpus(0.5)).toBe(5e8);
    expect(cpusToNanoCpus(2)).toBe(2e9);
  });
});

describe('isNetworkDenied', () => {
  it('is true only for an empty allowlist', () => {
    expect(isNetworkDenied([])).toBe(true);
    expect(isNetworkDenied(['example.com'])).toBe(false);
  });
});

describe('baseImageFor', () => {
  it('maps runtime to the configured base image', () => {
    expect(baseImageFor(config, 'python')).toBe('python:3.12-slim');
    expect(baseImageFor(config, 'node')).toBe('node:22-slim');
  });
});

describe('buildHostConfig', () => {
  const hc = buildHostConfig(request(), 'none');

  it('mounts the tool dir read-only and nothing else', () => {
    expect(hc?.Binds).toEqual([`/abs/tools/demo:${TOOL_MOUNT}:ro`]);
  });

  it('makes the root read-only with a tmpfs scratch', () => {
    expect(hc?.ReadonlyRootfs).toBe(true);
    expect(hc?.Tmpfs).toHaveProperty(WORK_DIR);
  });

  it('auto-removes the container', () => {
    expect(hc?.AutoRemove).toBe(true);
  });

  it('drops all capabilities and forbids privilege escalation', () => {
    expect(hc?.CapDrop).toEqual(['ALL']);
    expect(hc?.SecurityOpt).toEqual(['no-new-privileges']);
  });

  it('applies the resource caps', () => {
    expect(hc?.Memory).toBe(256 * 1024 * 1024);
    expect(hc?.NanoCpus).toBe(1e9);
    expect(hc?.PidsLimit).toBe(128);
  });

  it('passes the network mode through', () => {
    expect(hc?.NetworkMode).toBe('none');
    expect(buildHostConfig(request(), 'svod-sbx-int-x')?.NetworkMode).toBe('svod-sbx-int-x');
  });
});

describe('buildSandboxCreateOptions', () => {
  it('builds NetworkMode none for an empty allowlist (deny-by-default)', () => {
    const opts = buildSandboxCreateOptions(request(), config, { networkMode: 'none' });
    expect(opts.HostConfig?.NetworkMode).toBe('none');
    expect(opts.Image).toBe('python:3.12-slim');
    expect(opts.Cmd).toEqual(['python', 'tool.py', '--selftest']);
    expect(opts.WorkingDir).toBe(WORK_DIR);
    expect(opts.User).toBe('65534:65534');
    expect(opts.Tty).toBe(false);
  });

  it('does not set proxy env when no proxy is in use', () => {
    const opts = buildSandboxCreateOptions(request(), config, { networkMode: 'none' });
    expect(opts.Env).toBeUndefined();
  });

  it('threads proxy env into the workload when egress is allowlisted', () => {
    const opts = buildSandboxCreateOptions(
      request({ network: ['example.com'] }),
      config,
      { networkMode: 'svod-sbx-int-1', proxyEnv: { HTTP_PROXY: 'http://proxy:8080' } },
    );
    expect(opts.HostConfig?.NetworkMode).toBe('svod-sbx-int-1');
    expect(opts.Env).toContain('HTTP_PROXY=http://proxy:8080');
  });

  it('selects the node base image for a node runtime', () => {
    const opts = buildSandboxCreateOptions(request({ runtime: 'node' }), config, {
      networkMode: 'none',
    });
    expect(opts.Image).toBe('node:22-slim');
  });
});

describe('buildProxyCreateOptions', () => {
  const opts = buildProxyCreateOptions(
    config,
    '/abs/src/sandbox/proxy.js',
    ['example.com', 'api.example.org'],
    'svod-sbx-int-1',
    request().limits,
  );

  it('runs the proxy script read-only from the node base image', () => {
    expect(opts.Image).toBe('node:22-slim');
    expect(opts.Cmd?.[0]).toBe('node');
    expect(opts.HostConfig?.Binds?.[0]).toContain(':ro');
    expect(opts.HostConfig?.ReadonlyRootfs).toBe(true);
  });

  it('passes the allowlist to the proxy via env', () => {
    expect(opts.Env).toContain('ALLOWLIST=example.com,api.example.org');
  });

  it('joins the internal network and is itself locked down', () => {
    expect(opts.HostConfig?.NetworkMode).toBe('svod-sbx-int-1');
    expect(opts.HostConfig?.CapDrop).toEqual(['ALL']);
    expect(opts.HostConfig?.AutoRemove).toBe(true);
  });
});
