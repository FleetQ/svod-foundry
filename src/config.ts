// Configuration schema, loading, and secret-ref resolution.
//
// Config covers: the Svod MCP endpoint + bearer-token reference, Docker settings, the per-runtime
// base images, and the default sandbox resource limits. See config.sample.json.

import { readFileSync } from 'node:fs';
import { z } from 'zod';

/** A Svod-style secret reference: env:NAME | file:/path | keychain:NAME. Never an inline secret. */
const secretRefSchema = z
  .string()
  .regex(/^(env|file|keychain):.+/, 'must be a secret ref: env:NAME | file:/path | keychain:NAME');

export const limitsSchema = z.object({
  memory: z.string().default('256m'),
  cpus: z.number().positive().default(1),
  pidsLimit: z.number().int().positive().default(128),
  timeoutMs: z.number().int().positive().default(30_000),
});

export const configSchema = z.object({
  svod: z.object({
    /** Svod MCP endpoint (streamable HTTP; HTTPS when tls=true). */
    endpoint: z.string().url().default('http://127.0.0.1:7518/mcp'),
    /** Bearer-token reference. The token IS the identity (its agentId authors commits). */
    tokenRef: secretRefSchema,
    tls: z.boolean().default(false),
  }),
  docker: z.object({
    /** Docker Engine socket path; ignored when host/port are set. */
    socketPath: z.string().default('/var/run/docker.sock'),
    host: z.string().optional(),
    port: z.number().int().positive().optional(),
    /** Fixed base image per runtime (ADR-0003). */
    baseImages: z
      .object({
        python: z.string().default('python:3.12-slim'),
        node: z.string().default('node:22-slim'),
      })
      .prefault({}),
    /** Image used for the allowlisting egress proxy when a skill declares `network`. */
    egressProxyImage: z.string().default('nginx:1.27-alpine'),
  }).prefault({}),
  limits: limitsSchema.prefault({}),
});

export type Config = z.infer<typeof configSchema>;

/**
 * Resolve a Svod secret reference to its value.
 * Supports env: and file: in v1; keychain: is reserved (delegated to the host/Svod).
 */
export function resolveSecretRef(ref: string): string {
  const [scheme, ...rest] = ref.split(':');
  const value = rest.join(':');
  switch (scheme) {
    case 'env': {
      const v = process.env[value];
      if (!v) throw new Error(`secret ref ${ref}: environment variable ${value} is not set`);
      return v;
    }
    case 'file': {
      return readFileSync(value, 'utf8').trim();
    }
    case 'keychain':
      throw new Error('keychain: secret refs are not resolved by the foundry in v1');
    default:
      throw new Error(`unsupported secret ref scheme: ${scheme}`);
  }
}

/** Parse and validate a config object (already loaded from JSON). */
export function parseConfig(raw: unknown): Config {
  return configSchema.parse(raw);
}

/** Load config from a JSON file path and validate it. */
export function loadConfig(path: string): Config {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  return parseConfig(raw);
}
