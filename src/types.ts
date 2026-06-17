// Shared domain types for Svod Foundry.
//
// This file is the contract between the three internal subsystems:
//   - the Svod MCP client wrapper (src/svod/)
//   - the Docker sandbox executor (src/sandbox/)
//   - the foundry MCP server (src/foundry/)
//
// Keep changes here additive; subsystems import from this module and should not need
// to edit each other's code. See docs/adr/0003 (sandbox) and docs/adr/0004 (artifact).

/** Runtimes a synthesized tool can declare; each maps to a fixed sandbox base image (ADR-0003). */
export type Runtime = 'python' | 'node';

export const RUNTIMES: readonly Runtime[] = ['python', 'node'] as const;

export function isRuntime(value: unknown): value is Runtime {
  return value === 'python' || value === 'node';
}

/** Lifecycle status of a tool note in Svod (ADR-0001 / ADR-0004). */
export type ToolStatus = 'provisional' | 'active' | 'revoked';

/**
 * The frontmatter contract of a synthesized tool's SKILL.md (ADR-0004).
 * `runtime`, `entry`, and `selftest` are required for a tool to be verifiable/runnable.
 */
export interface SkillFrontmatter {
  name: string;
  description: string;
  type: 'tool';
  status: ToolStatus;
  runtime: Runtime;
  /** Script the sandbox executes for `run`, relative to the tool dir (e.g. "tool.py"). */
  entry: string;
  /** Deterministic self-test command for `verify` (e.g. "python tool.py --selftest"). */
  selftest: string;
  /** Egress allowlist (ADR-0003). Empty/absent => --network none. */
  network: string[];
  tags: string[];
  /** Svod secret references only (env:/file:/keychain:) — never literal secrets. */
  secrets: string[];
}

/** A parsed Agent Skill: its frontmatter, the raw SKILL.md body, and the single script. */
export interface ParsedSkill {
  frontmatter: SkillFrontmatter;
  body: string;
  script: {
    filename: string;
    contents: string;
  };
}

/** Resource bounds applied to every sandbox execution (ADR-0003). */
export interface SandboxLimits {
  /** Memory cap, e.g. "256m". */
  memory: string;
  /** CPU cap in fractional cores, e.g. 1 or 0.5. */
  cpus: number;
  /** Max number of processes/threads (defeats fork bombs). */
  pidsLimit: number;
  /** Wall-clock timeout in milliseconds; the container is killed on expiry. */
  timeoutMs: number;
}

/**
 * A single sandbox execution request. `verify` and `run` both build one of these and call the
 * identical executor (ADR-0003) — they differ only in `command`/`args`.
 */
export interface SandboxRequest {
  /** Absolute host path to the tool directory; mounted read-only into the container. */
  toolDir: string;
  runtime: Runtime;
  /** argv to execute inside the container (e.g. ["python", "tool.py", "--selftest"]). */
  command: string[];
  /** Egress allowlist from the skill frontmatter; empty => no network. */
  network: string[];
  limits: SandboxLimits;
}

/** The result of a sandbox execution. */
export interface SandboxResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  /** True if the wall-clock timeout fired (container was killed). */
  timedOut: boolean;
}

/** Result of `verify` — a green verify is the gate for `run`-outside-sandbox-never and `promote`. */
export interface VerifyResult {
  pass: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}
