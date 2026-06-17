import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseConfig, resolveSecretRef, configSchema } from '../src/config.js';

describe('config schema', () => {
  it('applies defaults and requires a token ref', () => {
    const cfg = parseConfig({ svod: { tokenRef: 'env:SVOD_TOKEN' } });
    expect(cfg.svod.endpoint).toBe('http://127.0.0.1:7518/mcp');
    expect(cfg.svod.tls).toBe(false);
    expect(cfg.docker.baseImages.python).toBe('python:3.12-slim');
    expect(cfg.docker.baseImages.node).toBe('node:22-slim');
    expect(cfg.limits.memory).toBe('256m');
    expect(cfg.limits.cpus).toBe(1);
    expect(cfg.limits.pidsLimit).toBe(128);
    expect(cfg.limits.timeoutMs).toBe(30_000);
    // Secure-by-default: the HTTP surface binds loopback, not all interfaces.
    expect(cfg.server.transport).toBe('http');
    expect(cfg.server.host).toBe('127.0.0.1');
    expect(cfg.server.port).toBe(7519);
    expect(cfg.server.path).toBe('/mcp');
  });

  it('accepts an HTTP auth token ref but rejects a literal', () => {
    expect(parseConfig({ svod: { tokenRef: 'env:T' }, server: { authTokenRef: 'env:H' } }).server.authTokenRef).toBe('env:H');
    expect(() => parseConfig({ svod: { tokenRef: 'env:T' }, server: { authTokenRef: 'literal' } })).toThrow();
  });

  it('rejects an inline (non-ref) token', () => {
    expect(() => parseConfig({ svod: { tokenRef: 'sk-literal-secret' } })).toThrow();
  });

  it('rejects a missing token ref', () => {
    expect(() => parseConfig({ svod: {} })).toThrow();
  });

  it('accepts env:, file:, keychain: token refs', () => {
    for (const ref of ['env:TOK', 'file:/run/secrets/tok', 'keychain:svod']) {
      expect(configSchema.shape.svod.safeParse({ tokenRef: ref }).success).toBe(true);
    }
  });

  it('honors explicit overrides', () => {
    const cfg = parseConfig({
      svod: { tokenRef: 'env:T', endpoint: 'https://svod.local/mcp', tls: true },
      limits: { memory: '512m', cpus: 2, pidsLimit: 64, timeoutMs: 5000 },
    });
    expect(cfg.svod.tls).toBe(true);
    expect(cfg.limits.memory).toBe('512m');
    expect(cfg.limits.cpus).toBe(2);
  });
});

describe('resolveSecretRef', () => {
  const KEY = 'SVOD_FOUNDRY_TEST_SECRET';
  beforeEach(() => {
    process.env[KEY] = 'shhh';
  });
  afterEach(() => {
    delete process.env[KEY];
  });

  it('resolves env: refs', () => {
    expect(resolveSecretRef(`env:${KEY}`)).toBe('shhh');
  });

  it('throws on a missing env var', () => {
    expect(() => resolveSecretRef('env:DEFINITELY_NOT_SET_VAR')).toThrow(/not set/);
  });

  it('does not resolve keychain: in v1', () => {
    expect(() => resolveSecretRef('keychain:svod')).toThrow(/not resolved/);
  });

  it('throws on an unknown scheme', () => {
    expect(() => resolveSecretRef('vault:foo')).toThrow(/unsupported/);
  });
});
