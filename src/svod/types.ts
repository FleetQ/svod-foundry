// Module-local types for the Svod MCP client wrapper (Milestone 2).
//
// These describe the params/results of the Svod typed-memory tools the foundry consumes
// (context_pack, search, read, write, promote, history, diff) as TypeScript interfaces.
//
// IMPORTANT — schema assumptions. We do NOT have Svod's exact tool input/output JSON schemas.
// The shapes below are designed from ADR-0001 (paths `messy/tools/<name>/...` /
// `vault/tools/<name>/...`; `write` takes path/content/expectedRevision; `promote` is a
// revision-checked move messy->vault then status:active; `context_pack` takes `enumerate` +
// filters) and the M2 brief. Result parsing is centralized in `client.ts` (`parseToolJson`) so a
// schema tweak in M4 is a one-line change. Every assumption is listed in src/svod/README.md and
// the M2 report. Treat field names here as the wrapper's *internal* contract, not a Svod guarantee.

/** A revision identifier as returned by Svod (git-backed). Opaque string; do not parse. */
export type Revision = string;

/** Lifecycle status of a Svod note (mirrors ../types.ts ToolStatus, kept module-local on purpose). */
export type NoteStatus = 'provisional' | 'active' | 'revoked';

/** Filters accepted by `context_pack` when enumerating notes (ADR-0001 recall primitive). */
export interface ContextPackFilter {
  /** Note type filter, e.g. `'tool'` for the synthesized-tool registry. */
  type?: string;
  /** Tag filter; a note matches if it carries all given tags. */
  tags?: string[];
  /** Lifecycle status filter, e.g. `'active'` for the live registry. */
  status?: NoteStatus;
}

/** Params for a `context_pack` call. */
export interface ContextPackParams {
  /** When true, return the full matching set verbatim/unranked (enumeration) rather than a ranked pack. */
  enumerate?: boolean;
  /** Free-text query for ranked recall; ignored/optional under `enumerate`. */
  query?: string;
  filter?: ContextPackFilter;
}

/** A single note as surfaced by recall/enumeration. `content` is present when Svod inlines it. */
export interface SvodNote {
  path: string;
  revision: Revision;
  status?: NoteStatus;
  type?: string;
  tags?: string[];
  content?: string;
  /** Any additional fields Svod returns are preserved here rather than dropped. */
  [extra: string]: unknown;
}

/** The result of `context_pack` — the active tool registry verbatim when enumerating tools. */
export interface ContextPackResult {
  notes: SvodNote[];
  /** Raw decoded JSON, in case callers need a field this interface doesn't model yet. */
  raw: unknown;
}

/** Params for `search` — ranked, query-driven recall over notes. */
export interface SearchParams {
  query: string;
  filter?: ContextPackFilter;
  limit?: number;
}

/** Params for `read` — fetch a single note's content + current revision. */
export interface ReadParams {
  path: string;
}

export interface ReadResult {
  path: string;
  content: string;
  revision: Revision;
  status?: NoteStatus;
}

/** Params for `write` — optimistic-concurrency create/update of a note. */
export interface WriteParams {
  path: string;
  content: string;
  /**
   * The revision the caller believes is current. Omit only for a first-time create.
   * A stale value yields a structured conflict (see SvodConflictError) — never a blind overwrite.
   */
  expectedRevision?: Revision;
}

/** Successful write — the new revision Svod committed. */
export interface WriteOk {
  ok: true;
  path: string;
  revision: Revision;
}

/**
 * Params for `promote` — revision-checked move of a single note from messy/ to vault/.
 * (Svod's promote is per-note: it moves `from` -> `to` and does NOT rewrite frontmatter status.)
 */
export interface PromoteParams {
  /** Source note path under messy/ (e.g. `messy/tools/<name>/SKILL.md`). */
  from: string;
  /** Destination note path under vault/ (e.g. `vault/tools/<name>/SKILL.md`). */
  to: string;
  /** Expected current revision of the source; a mismatch is a conflict. */
  expectedRevision?: Revision;
}

export interface PromoteResult {
  /** Destination path under vault/ (e.g. `vault/tools/<name>/`). */
  path: string;
  revision: Revision;
  status: NoteStatus;
}

/** Params for `history` — the revision log of a note. */
export interface HistoryParams {
  path: string;
  limit?: number;
}

export interface HistoryEntry {
  revision: Revision;
  /** Commit author — the Svod agentId (the bearer token IS the identity, ADR-0001). */
  author?: string;
  /** ISO-8601 timestamp, as Svod reports it. */
  timestamp?: string;
  message?: string;
}

export interface HistoryResult {
  path: string;
  entries: HistoryEntry[];
}

/** Params for `diff` — the unified diff of a note between two revisions. */
export interface DiffParams {
  path: string;
  from: Revision;
  to: Revision;
}

export interface DiffResult {
  path: string;
  from: Revision;
  to: Revision;
  /** Unified-diff text as Svod produces it. */
  diff: string;
}
