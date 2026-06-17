#!/usr/bin/env node
// Svod Foundry MCP server entry point.
//
// M1 scaffold: this is wired to the Svod client (M2), the sandbox executor (M3), and the
// foundry MCP tool surface (synthesize/verify/run/promote) in M4. For now it loads config so
// the binary fails fast on a missing/invalid config rather than at first tool call.

import { loadConfig } from './config.js';

const configPath = process.env.SVOD_FOUNDRY_CONFIG ?? 'config.json';

function main(): void {
  const config = loadConfig(configPath);
  console.error(
    `svod-foundry: config loaded (svod endpoint ${config.svod.endpoint}). ` +
      'MCP server wiring lands in M4.',
  );
}

main();
