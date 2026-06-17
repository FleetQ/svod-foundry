#!/usr/bin/env node
// Svod Foundry MCP server entry point (Milestone 4).
//
// Loads config, connects the Svod client (store of record), builds the Foundry (wired to the Docker
// sandbox), and exposes the synthesize/verify/run/promote MCP surface over the configured transport
// (streamable HTTP by default; stdio when spawned as a subprocess).

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { loadConfig, resolveSecretRef, type Config } from './config.js';
import { SvodClient } from './svod/index.js';
import { Foundry, buildMcpServer } from './foundry/index.js';

/** True for loopback bind addresses (no remote exposure). */
function isLoopback(host: string): boolean {
  return host === '127.0.0.1' || host === '::1' || host === 'localhost';
}

/** Constant-time bearer check; false on any shape/length mismatch. */
function bearerMatches(header: string | undefined, token: string): boolean {
  if (!header) return false;
  const expected = `Bearer ${token}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const configPath = process.env.SVOD_FOUNDRY_CONFIG ?? 'config.json';

async function main(): Promise<void> {
  const config = loadConfig(configPath);
  const svod = new SvodClient(config);
  await svod.connect();
  const foundry = new Foundry({ svod, config });

  if (config.server.transport === 'stdio') {
    await serveStdio(foundry);
  } else {
    await serveHttp(foundry, config);
  }

  const shutdown = async (): Promise<void> => {
    await svod.close().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

/** Stdio transport: one server bound to stdin/stdout (agent spawns the foundry as a subprocess). */
async function serveStdio(foundry: Foundry): Promise<void> {
  const server = buildMcpServer(foundry);
  await server.connect(new StdioServerTransport());
  log('svod-foundry: listening on stdio');
}

/**
 * Streamable HTTP transport in stateless mode: a fresh server + transport per request, sharing one
 * Foundry (and its single Svod connection). Mirrors Svod's networked MCP model.
 */
async function serveHttp(foundry: Foundry, config: Config): Promise<void> {
  const { host, port, path } = config.server;

  // Auth: a bearer token is required when configured, and strongly advised for any non-loopback bind.
  const authToken = config.server.authTokenRef
    ? resolveSecretRef(config.server.authTokenRef)
    : undefined;
  if (!authToken && !isLoopback(host)) {
    log(
      `WARNING: HTTP transport is bound to a non-loopback address (${host}) WITHOUT an auth token. ` +
        'Anyone who can reach this port can synthesize/run/promote tools. Set server.authTokenRef.',
    );
  }

  // DNS-rebinding protection: only accept the Host headers (and Origins, if configured) we expect.
  const allowedHosts = config.server.allowedHosts ?? [
    `${host}:${port}`,
    `127.0.0.1:${port}`,
    `localhost:${port}`,
  ];
  const allowedOrigins = config.server.allowedOrigins;

  const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    void handleHttp(foundry, { mcpPath: path, authToken, allowedHosts, allowedOrigins }, req, res);
  });

  await new Promise<void>((resolve) => httpServer.listen(port, host, resolve));
  log(`svod-foundry: listening on http://${host}:${port}${path}${authToken ? ' (auth required)' : ''}`);
}

interface HttpGuards {
  mcpPath: string;
  authToken: string | undefined;
  allowedHosts: string[];
  allowedOrigins: string[] | undefined;
}

async function handleHttp(
  foundry: Foundry,
  guards: HttpGuards,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname !== guards.mcpPath) {
    res.writeHead(404).end('not found');
    return;
  }

  // Bearer auth (constant-time). Enforced whenever a token is configured.
  if (guards.authToken && !bearerMatches(req.headers.authorization, guards.authToken)) {
    res.writeHead(401, { 'WWW-Authenticate': 'Bearer' }).end('unauthorized');
    return;
  }

  // Stateless: new server + transport per request, so there is no cross-request session state.
  // DNS-rebinding protection rejects unexpected Host/Origin headers at the transport layer.
  const server = buildMcpServer(foundry);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableDnsRebindingProtection: true,
    allowedHosts: guards.allowedHosts,
    allowedOrigins: guards.allowedOrigins,
  });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport);
    const body = req.method === 'POST' ? await readJsonBody(req) : undefined;
    await transport.handleRequest(req, res, body);
  } catch (err) {
    log(`request error: ${(err as Error).message}`);
    if (!res.headersSent) res.writeHead(500).end('internal error');
  }
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => {
      if (!data) return resolve(undefined);
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function log(message: string): void {
  // Logs go to stderr so they never corrupt an stdio MCP stream on stdout.
  console.error(message);
}

main().catch((err) => {
  console.error(`svod-foundry: fatal: ${(err as Error).message}`);
  process.exit(1);
});
