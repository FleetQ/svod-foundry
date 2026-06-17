// Copy non-TS runtime assets into dist/ after `tsc`.
//
// The sandbox egress proxy ships as a raw .js script (it runs inside a node container, not through
// the TS build). tsc does not copy it, and the published package includes dist/ but not src/, so we
// copy it next to the compiled executor that resolves it. See src/sandbox/executor.ts.

import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const assets = [['src/sandbox/proxy.js', 'dist/sandbox/proxy.js']];

for (const [from, to] of assets) {
  const dest = join(root, to);
  await mkdir(dirname(dest), { recursive: true });
  await copyFile(join(root, from), dest);
  console.error(`copied ${from} -> ${to}`);
}
