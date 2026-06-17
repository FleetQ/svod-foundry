#!/usr/bin/env node
// End-to-end demo of the foundry loop: synthesize -> verify -> run -> promote.
//
// Drives the built Foundry directly against the configured Svod engine (store of record) and the
// Docker daemon (sandbox). Run it after building and bringing the stack up:
//
//   npm run build
//   cp config.sample.json config.json     # edit: Svod endpoint + token ref
//   docker compose up -d                  # a live Svod engine + the sandbox base images
//   node examples/demo.mjs
//
// It synthesizes the json-extract sample tool (examples/json-extract/), verifies it in the sandbox,
// runs it against arguments, and promotes it to the active registry — printing each step.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { loadConfig } from '../dist/config.js';
import { SvodClient } from '../dist/svod/index.js';
import { Foundry } from '../dist/foundry/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const configPath = process.env.SVOD_FOUNDRY_CONFIG ?? 'config.json';

function show(step, value) {
  console.log(`\n=== ${step} ===`);
  console.log(JSON.stringify(value, null, 2));
}

async function main() {
  const config = loadConfig(configPath);
  const svod = new SvodClient(config);

  try {
    await svod.connect();
  } catch (err) {
    console.error(
      `Could not reach Svod at ${config.svod.endpoint}: ${err.message}\n` +
        'Bring it up with `docker compose up -d` and set a WRITE-role token, then retry.',
    );
    process.exit(1);
  }

  const foundry = new Foundry({ svod, config });
  const script = readFileSync(join(here, 'json-extract', 'tool.py'), 'utf8');

  const synthesized = await foundry.synthesize({
    name: 'json-extract',
    description: 'Print one top-level field from a JSON object. Deterministic, no network.',
    runtime: 'python',
    script,
    tags: ['example', 'json'],
  });
  show('synthesize', synthesized);

  const verified = await foundry.verify('json-extract');
  show('verify', verified);
  if (!verified.pass) {
    console.error('verify failed — not promoting.');
    await svod.close();
    process.exit(1);
  }

  const ran = await foundry.run('json-extract', ['name', '{"name": "svod", "n": 2}']);
  show('run (name)', ran);

  const promoted = await foundry.promote('json-extract');
  show('promote', promoted);

  console.log('\nDone. The tool is now in the active registry — recall it with Svod context_pack.');
  await svod.close();
}

main().catch((err) => {
  console.error(`demo failed: ${err.message}`);
  process.exit(1);
});
