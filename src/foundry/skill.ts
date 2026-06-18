// Agent Skill assembly + parsing (Milestone 4, ADR-0004).
//
// Builds a canonical SKILL.md + script from a synthesize spec, and parses a SKILL.md read back from
// Svod into validated frontmatter. The selftest/entry commands reference the in-container tool mount
// (TOOL_MOUNT) so they run identically in the sandbox under both verify and run.

import matter from 'gray-matter';

import type { Runtime, SkillFrontmatter, ToolStatus } from '../types.js';
import { TOOL_MOUNT } from '../sandbox/spec.js';
import { skillFrontmatterSchema, type ResolvedSpec } from './spec.js';

/** Interpreter binary for a runtime (also the argv[0] of generated commands). */
export function interpreterFor(runtime: Runtime): string {
  return runtime === 'python' ? 'python' : 'node';
}

/** Default script filename for a runtime. */
export function defaultEntry(runtime: Runtime): string {
  return runtime === 'python' ? 'tool.py' : 'tool.js';
}

/** The default self-test command: `<interp> <toolMount>/<entry> --selftest`. */
export function defaultSelftest(runtime: Runtime, entry: string): string {
  return `${interpreterFor(runtime)} ${TOOL_MOUNT}/${entry} --selftest`;
}

export interface SkillArtifact {
  name: string;
  frontmatter: SkillFrontmatter;
  /** The SKILL.md file content (frontmatter + body). */
  skillMarkdown: string;
  script: { filename: string; contents: string };
}

/** Assemble a canonical Agent Skill (SKILL.md + script) from a validated synthesize spec. */
export function buildSkillArtifact(spec: ResolvedSpec): SkillArtifact {
  const entry = spec.entry ?? defaultEntry(spec.runtime);
  const selftest = spec.selftest ?? defaultSelftest(spec.runtime, entry);

  const frontmatter: SkillFrontmatter = {
    name: spec.name,
    description: spec.description,
    type: 'tool',
    status: 'provisional',
    runtime: spec.runtime,
    entry,
    selftest,
    network: spec.network,
    tags: spec.tags,
    secrets: spec.secrets,
  };

  const body = renderBody(spec, entry, selftest);
  // gray-matter stringifies YAML frontmatter + body deterministically.
  const skillMarkdown = matter.stringify(body, frontmatter as unknown as Record<string, unknown>);

  return {
    name: spec.name,
    frontmatter,
    skillMarkdown,
    script: { filename: entry, contents: ensureTrailingNewline(spec.script) },
  };
}

/** Parse a SKILL.md read from Svod into validated frontmatter (throws on an invalid/unsafe skill). */
export function parseSkillFrontmatter(skillMarkdown: string): SkillFrontmatter {
  const parsed = matter(skillMarkdown);
  const result = skillFrontmatterSchema.safeParse(parsed.data);
  if (!result.success) {
    throw new Error(`invalid SKILL.md frontmatter: ${result.error.issues.map((i) => i.message).join('; ')}`);
  }
  return result.data;
}

/** Return the SKILL.md with its frontmatter `status` set to the given lifecycle value. */
export function setSkillStatus(skillMarkdown: string, status: ToolStatus): string {
  const parsed = matter(skillMarkdown);
  parsed.data.status = status;
  return matter.stringify(parsed.content, parsed.data);
}

/**
 * Split a shell-ish command string into argv. Handles plain tokens and double-quoted segments —
 * enough for the selftest/entry commands the foundry generates. Not a full shell parser.
 */
export function splitCommand(command: string): string[] {
  const argv: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(command)) !== null) {
    argv.push(m[1] !== undefined ? m[1] : m[2]!);
  }
  return argv;
}

/** The argv to run a tool's `entry` with caller args, against the in-container mount. */
export function runCommand(frontmatter: SkillFrontmatter, args: string[]): string[] {
  return [interpreterFor(frontmatter.runtime), `${TOOL_MOUNT}/${frontmatter.entry}`, ...args];
}

function renderBody(spec: ResolvedSpec, entry: string, selftest: string): string {
  const lines = [
    `# ${spec.name}`,
    '',
    spec.description,
    '',
    '## Runtime',
    '',
    `- runtime: \`${spec.runtime}\``,
    `- entry: \`${entry}\``,
    `- self-test: \`${selftest}\``,
    `- network: ${spec.network.length ? spec.network.map((d) => `\`${d}\``).join(', ') : '_none (sandboxed with --network none)_'}`,
    '',
    '## Self-test',
    '',
    'The self-test is deterministic — given no external state it returns a stable pass/fail. It is the',
    'gate `verify` runs in the sandbox before this tool may be promoted to `active`.',
  ];
  if (spec.body && spec.body.trim().length > 0) {
    lines.push('', '## Notes', '', spec.body.trim());
  }
  return `${lines.join('\n')}\n`;
}

function ensureTrailingNewline(s: string): string {
  return s.endsWith('\n') ? s : `${s}\n`;
}
