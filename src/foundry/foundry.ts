// The Foundry — orchestrates synthesize/verify/run/promote (Milestone 4).
//
// Wires the Svod client (M2, store of record) to the sandbox executor (M3, contained execution).
// The dependencies are injected behind narrow interfaces so the whole loop is unit-testable with a
// fake Svod and a fake executor — no Docker, no network.
//
// Invariants enforced here:
//   - synthesize recalls Svod first and does not rebuild an existing ACTIVE tool (ADR-0005).
//   - verify and run execute ONLY via the sandbox executor (ADR-0003) — there is no host path.
//   - promote re-runs verify and proceeds ONLY on a green result (ADR-0001) — structural, not
//     dependent on the caller having called verify first.

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Config } from '../config.js';
import type { SandboxRequest, SandboxResult, SkillFrontmatter, VerifyResult } from '../types.js';
import { executeInSandbox } from '../sandbox/index.js';
import { SvodConflictError } from '../svod/index.js';
import type {
  PromoteParams,
  PromoteResult,
  ReadParams,
  ReadResult,
  SvodNote,
  WriteOk,
  WriteParams,
} from '../svod/index.js';
import { synthesizeSpecSchema, type SynthesizeSpec } from './spec.js';
import { buildSkillArtifact, parseSkillFrontmatter, runCommand, splitCommand } from './skill.js';

/** The slice of SvodClient the foundry depends on (test seam — a fake satisfies it). */
export interface SvodLike {
  recallTools(opts?: { tags?: string[] }): Promise<SvodNote[]>;
  read(params: ReadParams): Promise<ReadResult>;
  write(params: WriteParams): Promise<WriteOk>;
  promote(params: PromoteParams): Promise<PromoteResult>;
}

/** The sandbox execution function (injectable; defaults to the real Docker executor). */
export type ExecuteFn = (request: SandboxRequest, config: Config) => Promise<SandboxResult>;

export interface FoundryDeps {
  svod: SvodLike;
  config: Config;
  /** Override the sandbox executor (tests inject a fake). Defaults to executeInSandbox. */
  execute?: ExecuteFn;
}

export interface SynthesizeResult {
  name: string;
  revision: string;
  /** True when an active tool of the same name already existed and synthesis was skipped. */
  skipped: boolean;
  reason?: string;
}

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface PromoteOutcome {
  promoted: boolean;
  /** The verify result that gated promotion. */
  verify: VerifyResult;
  /** Present only when promoted. */
  path?: string;
  revision?: string;
  status?: string;
}

export class Foundry {
  private readonly svod: SvodLike;
  private readonly config: Config;
  private readonly execute: ExecuteFn;

  constructor(deps: FoundryDeps) {
    this.svod = deps.svod;
    this.config = deps.config;
    this.execute = deps.execute ?? executeInSandbox;
  }

  // --- synthesize --------------------------------------------------------------------------------

  /**
   * Recall-check Svod, then assemble + write a provisional Agent Skill (ADR-0005). Returns the
   * existing tool unchanged if an ACTIVE tool of the same name already covers it.
   */
  async synthesize(specInput: SynthesizeSpec): Promise<SynthesizeResult> {
    const spec = synthesizeSpecSchema.parse(specInput);

    const existing = await this.findActiveTool(spec.name);
    if (existing) {
      return {
        name: spec.name,
        revision: existing.revision,
        skipped: true,
        reason: `an active tool named '${spec.name}' already exists; not rebuilding (recall-first)`,
      };
    }

    const artifact = buildSkillArtifact(spec);
    const base = messyBase(spec.name);

    // Write the script first, then the SKILL.md (the note recall surfaces). Both are creates;
    // a re-synthesis over an existing provisional draft updates with the current revision.
    await this.upsert({ path: `${base}${artifact.script.filename}`, content: artifact.script.contents });
    const skill = await this.upsert({ path: `${base}SKILL.md`, content: artifact.skillMarkdown });

    return { name: spec.name, revision: skill.revision, skipped: false };
  }

  // --- verify ------------------------------------------------------------------------------------

  /** Run the tool's self-test in the sandbox and report pass/fail. The gate for promote. */
  async verify(name: string): Promise<VerifyResult> {
    const tool = await this.readTool(name);
    const result = await this.executeInTool(tool.fm, tool.script.content, splitCommand(tool.fm.selftest));
    return {
      pass: result.exitCode === 0 && !result.timedOut,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      timedOut: result.timedOut,
    };
  }

  // --- run ---------------------------------------------------------------------------------------

  /** Execute the tool against caller args — through the identical sandbox path used by verify. */
  async run(name: string, args: string[] = []): Promise<RunResult> {
    const tool = await this.readTool(name);
    const result = await this.executeInTool(tool.fm, tool.script.content, runCommand(tool.fm, args));
    return {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      timedOut: result.timedOut,
    };
  }

  // --- promote -----------------------------------------------------------------------------------

  /**
   * Promote a provisional tool to active — ONLY on a green verify. Re-runs verify internally so the
   * guarantee is structural. Svod performs the revision-checked move messy/ -> vault/, status:active.
   */
  async promote(name: string): Promise<PromoteOutcome> {
    const verify = await this.verify(name);
    if (!verify.pass) {
      return { promoted: false, verify };
    }
    // Read the provisional SKILL.md for its current revision (optimistic-concurrency on the move).
    const skill = await this.svod.read({ path: `${messyBase(name)}SKILL.md` });
    const result = await this.svod.promote({
      path: messyBase(name),
      expectedRevision: skill.revision,
    });
    return {
      promoted: true,
      verify,
      path: result.path,
      revision: result.revision,
      status: result.status,
    };
  }

  // --- internals ---------------------------------------------------------------------------------

  /** Find an ACTIVE tool of this name in the recalled registry, if any. */
  private async findActiveTool(name: string): Promise<SvodNote | undefined> {
    const tools = await this.svod.recallTools();
    return tools.find((n) => nameFromPath(n.path) === name && n.status === 'active');
  }

  /** Write a note; on an optimistic-concurrency conflict, update with the current revision. */
  private async upsert(params: WriteParams): Promise<WriteOk> {
    try {
      return await this.svod.write(params);
    } catch (e) {
      if (e instanceof SvodConflictError) {
        // A draft already exists; re-synthesis intentionally replaces it. Use the current revision
        // (not a blind overwrite) per the optimistic-concurrency contract.
        return await this.svod.write({ ...params, expectedRevision: e.currentRevision });
      }
      throw e;
    }
  }

  /** Read a tool (messy first, then vault), returning its frontmatter + script. */
  private async readTool(
    name: string,
  ): Promise<{ base: string; fm: SkillFrontmatter; script: ReadResult }> {
    for (const base of [messyBase(name), vaultBase(name)]) {
      let skill: ReadResult;
      try {
        skill = await this.svod.read({ path: `${base}SKILL.md` });
      } catch {
        continue; // not at this base; try the next
      }
      // A found-but-malformed skill is a hard error — do not silently fall through to vault.
      const fm = parseSkillFrontmatter(skill.content);
      const script = await this.svod.read({ path: `${base}${fm.entry}` });
      return { base, fm, script };
    }
    throw new Error(`tool '${name}' not found in messy/ or vault/`);
  }

  /** Materialize SKILL.md + script to a temp dir and execute the command in the sandbox. */
  private async executeInTool(
    fm: SkillFrontmatter,
    scriptContents: string,
    command: string[],
  ): Promise<SandboxResult> {
    const dir = await mkdtemp(join(tmpdir(), 'svod-foundry-'));
    try {
      await writeFile(join(dir, fm.entry), scriptContents, 'utf8');
      const request: SandboxRequest = {
        toolDir: dir,
        runtime: fm.runtime,
        command,
        network: fm.network,
        limits: this.config.limits,
      };
      return await this.execute(request, this.config);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

// --- path helpers --------------------------------------------------------------------------------

function messyBase(name: string): string {
  return `messy/tools/${name}/`;
}

function vaultBase(name: string): string {
  return `vault/tools/${name}/`;
}

/** Extract the tool name from a note path like `vault/tools/<name>/SKILL.md`. */
export function nameFromPath(path: string): string | undefined {
  const m = /(?:^|\/)tools\/([^/]+)\//.exec(path);
  return m ? m[1] : undefined;
}
