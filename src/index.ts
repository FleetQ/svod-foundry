#!/usr/bin/env node
// Svod Foundry MCP server entry point (Milestone 4).
//
// Loads config, connects the Svod client (store of record), builds the Foundry (wired to the Docker
// sandbox), and exposes the synthesize/verify/run/promote MCP surface over the configured transport
// (streamable HTTP by default; stdio when spawned as a subprocess).

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { loadConfig, type Config } from './config.js';
import { SvodClient } from './svod/index.js';
import { Foundry, buildMcpServer } from './foundry/index.js';

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

  const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    void handleHttp(foundry, path, req, res);
  });

  await new Promise<void>((resolve) => httpServer.listen(port, host, resolve));
  log(`svod-foundry: listening on http://${host}:${port}${path}`);
}

async function handleHttp(
  foundry: Foundry,
  mcpPath: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname !== mcpPath) {
    res.writeHead(404).end('not found');
    return;
  }

  // Stateless: new server + transport per request, so there is no cross-request session state.
  const server = buildMcpServer(foundry);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
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
