// Input/frontmatter schemas for the foundry (Milestone 4).
//
// `synthesize` receives a spec from the calling agent (the agent is the code generator; the foundry
// assembles + governs — ADR-0005). We validate it at the boundary. We also validate the frontmatter
// of any SKILL.md we read back from Svod before running it (ADR-0004 requires runtime/entry/selftest).

import { z } from 'zod';

/** kebab-case tool name: matches the directory and the frontmatter `name`. */
export const TOOL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A Svod secret reference (env:/file:/keychain:) — never an inline secret (ADR-0004). */
const secretRefSchema = z
  .string()
  .regex(/^(env|file|keychain):.+/, 'secrets must be refs: env:NAME | file:/path | keychain:NAME');

export const runtimeSchema = z.enum(['python', 'node']);

/**
 * The spec an agent passes to `synthesize`. The agent supplies the creative parts (script,
 * self-test); the foundry assembles the canonical Agent Skill and writes a provisional draft.
 */
export const synthesizeSpecSchema = z.object({
  name: z.string().regex(TOOL_NAME_RE, 'name must be kebab-case (a-z, 0-9, hyphens)'),
  description: z.string().min(1, 'description is required'),
  runtime: runtimeSchema,
  /** The single executable script's source. Untrusted — only ever runs in the sandbox. */
  script: z.string().min(1, 'script is required'),
  /** Script filename; defaults to tool.py / tool.js by runtime. */
  entry: z.string().min(1).optional(),
  /** Self-test command; defaults to `<interp> <toolMount>/<entry> --selftest`. */
  selftest: z.string().min(1).optional(),
  /** Egress allowlist (ADR-0003). Empty => the sandbox gets --network none. */
  network: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  /** Svod secret references only — never literal secrets. */
  secrets: z.array(secretRefSchema).default([]),
  /** Optional extra Markdown guidance appended to the SKILL.md body. */
  body: z.string().optional(),
});

export type SynthesizeSpec = z.input<typeof synthesizeSpecSchema>;
export type ResolvedSpec = z.output<typeof synthesizeSpecSchema>;

/**
 * The frontmatter contract we require of any SKILL.md before running it (ADR-0004). `runtime`,
 * `entry`, and `selftest` are mandatory for a tool to be verifiable/runnable.
 */
export const skillFrontmatterSchema = z.object({
  name: z.string().regex(TOOL_NAME_RE),
  description: z.string(),
  type: z.literal('tool'),
  status: z.enum(['provisional', 'active', 'revoked']),
  runtime: runtimeSchema,
  entry: z.string().min(1),
  selftest: z.string().min(1),
  network: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  secrets: z.array(z.string()).default([]),
});
