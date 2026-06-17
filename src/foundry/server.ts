// The foundry MCP server surface (Milestone 4).
//
// Exposes exactly four tools to calling agents: synthesize / verify / run / promote. Listing/recall
// is deliberately NOT here — agents use Svod's context_pack/search directly (ADR-0001).

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { synthesizeSpecSchema, type SynthesizeSpec } from './spec.js';
import type { Foundry } from './foundry.js';

/** Build a fresh McpServer bound to a Foundry. Cheap — safe to construct per request (stateless HTTP). */
export function buildMcpServer(foundry: Foundry): McpServer {
  const server = new McpServer({ name: 'svod-foundry', version: '0.1.0' });

  server.registerTool(
    'synthesize',
    {
      title: 'Synthesize a tool',
      description:
        'Recall-check Svod and, if no active tool already covers it, assemble an Agent Skill ' +
        '(SKILL.md + script) from the spec and write it as a provisional draft under ' +
        'messy/tools/<name>/. The script is untrusted and only ever runs in the sandbox. Returns ' +
        '{ name, revision, skipped }.',
      inputSchema: synthesizeSpecSchema.shape,
    },
    async (args) => jsonResult(await foundry.synthesize(args as SynthesizeSpec)),
  );

  server.registerTool(
    'verify',
    {
      title: 'Verify a tool',
      description:
        "Run the tool's deterministic self-test inside the sandbox. Returns { pass, exitCode, " +
        'stdout, stderr, timedOut }. A green verify is required before promote.',
      inputSchema: { name: z.string() },
    },
    async ({ name }) => jsonResult(await foundry.verify(name)),
  );

  server.registerTool(
    'run',
    {
      title: 'Run a tool',
      description:
        'Execute the tool against arguments — through the identical sandbox path used by verify. ' +
        'Returns { exitCode, stdout, stderr, timedOut }.',
      inputSchema: { name: z.string(), args: z.array(z.string()).optional() },
    },
    async ({ name, args }) => jsonResult(await foundry.run(name, args ?? [])),
  );

  server.registerTool(
    'promote',
    {
      title: 'Promote a tool',
      description:
        'Re-verify the tool and, ONLY on a green verify, publish it: Svod moves ' +
        'messy/tools/<name>/ -> vault/tools/<name>/ and sets status:active. Returns ' +
        '{ promoted, verify, path?, revision?, status? }.',
      inputSchema: { name: z.string() },
    },
    async ({ name }) => jsonResult(await foundry.promote(name)),
  );

  return server;
}

/** Wrap a result as an MCP tool response (JSON in a text block — agents parse it). */
function jsonResult(value: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}
