// Public surface of the foundry orchestration + MCP server (Milestone 4).

export { Foundry, nameFromPath } from './foundry.js';
export type {
  SvodLike,
  ExecuteFn,
  FoundryDeps,
  SynthesizeResult,
  RunResult,
  PromoteOutcome,
} from './foundry.js';
export { buildMcpServer } from './server.js';
export {
  buildSkillArtifact,
  parseSkillFrontmatter,
  splitCommand,
  runCommand,
  interpreterFor,
  defaultEntry,
  defaultSelftest,
} from './skill.js';
export type { SkillArtifact } from './skill.js';
export { synthesizeSpecSchema, skillFrontmatterSchema, runtimeSchema, TOOL_NAME_RE } from './spec.js';
export type { SynthesizeSpec, ResolvedSpec } from './spec.js';
