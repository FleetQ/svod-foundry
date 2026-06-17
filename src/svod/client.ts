// SvodClient — an MCP client wrapper for the Svod engine (Milestone 2).
//
// Talks to Svod over streamable HTTP with `Authorization: Bearer <token>` (the token IS the
// identity; ADR-0001). Wraps the typed-memory tools the foundry consumes: context_pack, search,
// read, write, promote, history, diff. Result parsing is centralized in `parseToolJson` so a Svod
// schema tweak is a one-line change (see src/svod/types.ts for the schema assumptions).
//
// Optimistic concurrency: `write`/`promote` carry `expectedRevision`. A stale call returns a
// STRUCTURED conflict from Svod (current content + current revision), not a thrown protocol error.
// We detect that shape and throw a typed `SvodConflictError` carrying the current content, so a
// caller can re-read / merge / retry. We never blind-overwrite.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import type { Config } from '../config.js';
import { resolveSecretRef } from '../config.js';
import { SvodConflictError, SvodParseError, SvodToolError } from './errors.js';
import type {
  ContextPackParams,
  ContextPackResult,
  DiffParams,
  DiffResult,
  HistoryParams,
  HistoryResult,
  PromoteParams,
  PromoteResult,
  ReadParams,
  ReadResult,
  Revision,
  SearchParams,
  SvodNote,
  WriteOk,
  WriteParams,
} from './types.js';

/** A text content block as MCP returns it. */
interface TextBlock {
  type: 'text';
  text: string;
}

/** The slice of an MCP CallToolResult this wrapper relies on (seam-friendly, structurally typed). */
interface CallToolResult {
  content?: Array<{ type: string; text?: string } | Record<string, unknown>>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

/**
 * The minimal MCP client surface SvodClient needs. The real SDK `Client` satisfies it; unit tests
 * inject a fake to exercise parsing / conflict / error paths with no network. This is the test seam.
 */
export interface McpClientLike {
  connect(transport: unknown): Promise<void>;
  close(): Promise<void>;
  callTool(params: { name: string; arguments?: Record<string, unknown> }): Promise<CallToolResult>;
}

export interface SvodClientOptions {
  /** Inject a pre-built MCP client (tests, or a custom transport). When set, connect/close are no-ops on the transport. */
  client?: McpClientLike;
}

export class SvodClient {
  private readonly config: Config;
  private readonly injected: McpClientLike | undefined;
  private client: McpClientLike | undefined;
  private transport: StreamableHTTPClientTransport | undefined;

  constructor(config: Config, options: SvodClientOptions = {}) {
    this.config = config;
    this.injected = options.client;
  }

  /** Open the MCP connection. Resolves the bearer token and wires it into the transport headers. */
  async connect(): Promise<void> {
    if (this.injected) {
      this.client = this.injected;
      await this.client.connect(undefined);
      return;
    }
    const token = resolveSecretRef(this.config.svod.tokenRef);
    this.transport = new StreamableHTTPClientTransport(new URL(this.config.svod.endpoint), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    const client = new Client({ name: 'svod-foundry', version: '0.1.0' });
    await client.connect(this.transport);
    this.client = client as unknown as McpClientLike;
  }

  /** Close the MCP connection cleanly. Safe to call when never connected. */
  async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
    }
    this.client = undefined;
    this.transport = undefined;
  }

  // --- recall ------------------------------------------------------------------------------------

  /** Low-level context_pack. With `enumerate:true` + a type filter it returns notes verbatim/unranked. */
  async contextPack(params: ContextPackParams = {}): Promise<ContextPackResult> {
    const raw = await this.call('context_pack', toArgs(params));
    return { notes: extractNotes(raw, 'context_pack'), raw };
  }

  /**
   * THE recall primitive: enumerate the full active tool registry verbatim/unranked.
   * Calls context_pack with `enumerate:true` and a `type:tool` filter (+ optional tags).
   */
  async recallTools(opts: { tags?: string[] } = {}): Promise<SvodNote[]> {
    const filter: ContextPackParams['filter'] = { type: 'tool' };
    if (opts.tags && opts.tags.length > 0) filter.tags = opts.tags;
    const result = await this.contextPack({ enumerate: true, filter });
    return result.notes;
  }

  /** Ranked, query-driven recall over notes. */
  async search(params: SearchParams): Promise<SvodNote[]> {
    const raw = await this.call('search', toArgs(params));
    return extractNotes(raw, 'search');
  }

  // --- read/write --------------------------------------------------------------------------------

  /** Fetch a single note's content + current revision. */
  async read(params: ReadParams): Promise<ReadResult> {
    const raw = await this.call('read', toArgs(params));
    const obj = asObject(raw, 'read');
    return {
      path: str(obj.path, params.path),
      content: str(obj.content, ''),
      revision: str(obj.revision, ''),
      status: obj.status as ReadResult['status'],
    };
  }

  /**
   * Optimistic-concurrency write. Returns `{ ok:true, revision }` on success.
   * A stale `expectedRevision` throws `SvodConflictError` carrying the current content + revision —
   * the wrapper never blind-overwrites. Callers catch it to re-read / merge / retry.
   */
  async write(params: WriteParams): Promise<WriteOk> {
    const raw = await this.call('write', toArgs(params));
    throwIfConflict(raw, params.path);
    const obj = asObject(raw, 'write');
    return { ok: true, path: str(obj.path, params.path), revision: str(obj.revision, '') };
  }

  // --- lifecycle ---------------------------------------------------------------------------------

  /**
   * Revision-checked promote: Svod moves messy/ -> vault/ and sets status:active.
   * A stale `expectedRevision` throws `SvodConflictError` (same contract as `write`).
   */
  async promote(params: PromoteParams): Promise<PromoteResult> {
    const raw = await this.call('promote', toArgs(params));
    throwIfConflict(raw, params.path);
    const obj = asObject(raw, 'promote');
    return {
      path: str(obj.path, ''),
      revision: str(obj.revision, ''),
      status: (obj.status as PromoteResult['status']) ?? 'active',
    };
  }

  // --- audit -------------------------------------------------------------------------------------

  /** The revision log of a note. */
  async history(params: HistoryParams): Promise<HistoryResult> {
    const raw = await this.call('history', toArgs(params));
    const obj = asObject(raw, 'history');
    const entries = Array.isArray(obj.entries) ? (obj.entries as HistoryResult['entries']) : [];
    return { path: str(obj.path, params.path), entries };
  }

  /** The unified diff of a note between two revisions. */
  async diff(params: DiffParams): Promise<DiffResult> {
    const raw = await this.call('diff', toArgs(params));
    const obj = asObject(raw, 'diff');
    return {
      path: str(obj.path, params.path),
      from: str(obj.from, params.from),
      to: str(obj.to, params.to),
      diff: str(obj.diff, ''),
    };
  }

  // --- internals ---------------------------------------------------------------------------------

  /** Call a Svod tool and return its decoded JSON payload. Throws if not connected or tool errored. */
  private async call(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.client) throw new SvodToolError(name, 'client is not connected (call connect() first)');
    const result = await this.client.callTool({ name, arguments: args });
    return parseToolResult(name, result);
  }
}

// --- centralized result parsing (one place to adapt if Svod's schema shifts) ---------------------

/**
 * Decode an MCP CallToolResult into Svod's JSON payload. Svod returns JSON in a text content block;
 * we also accept `structuredContent` when present. `isError` (non-conflict) becomes SvodToolError.
 */
function parseToolResult(tool: string, result: CallToolResult): unknown {
  // Prefer structuredContent if the server provides it.
  if (result.structuredContent && !result.isError) {
    return result.structuredContent;
  }
  const text = firstText(result.content);
  const payload = text !== undefined ? parseToolJson(tool, text) : (result.structuredContent ?? {});

  if (result.isError) {
    // A conflict is a structured, non-exceptional result even when flagged isError by some servers;
    // let the per-tool conflict check (throwIfConflict) own that. Other errors throw here.
    if (!looksLikeConflict(payload)) {
      throw new SvodToolError(tool, errorMessageOf(payload, text));
    }
  }
  return payload;
}

/** Parse a JSON text block defensively. */
function parseToolJson(tool: string, text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new SvodParseError(tool, `tool returned non-JSON text: ${truncate(text)}`);
  }
}

function firstText(content: CallToolResult['content']): string | undefined {
  if (!content) return undefined;
  for (const block of content) {
    if (isTextBlock(block)) return block.text;
  }
  return undefined;
}

function isTextBlock(block: unknown): block is TextBlock {
  return (
    typeof block === 'object' &&
    block !== null &&
    (block as { type?: unknown }).type === 'text' &&
    typeof (block as { text?: unknown }).text === 'string'
  );
}

// --- conflict detection --------------------------------------------------------------------------

/**
 * Detect Svod's structured optimistic-concurrency conflict shape and throw SvodConflictError.
 * Accepted shapes (tolerant by design):
 *   { conflict: { currentContent, currentRevision } }
 *   { conflict: true, currentContent, currentRevision }
 *   { status: 'conflict', currentContent, currentRevision }
 */
function throwIfConflict(payload: unknown, path: string): void {
  if (!looksLikeConflict(payload)) return;
  const c = conflictBody(payload);
  throw new SvodConflictError({
    path,
    currentRevision: str(c.currentRevision ?? c.revision, ''),
    currentContent: optStr(c.currentContent ?? c.content),
  });
}

function looksLikeConflict(payload: unknown): boolean {
  if (typeof payload !== 'object' || payload === null) return false;
  const o = payload as Record<string, unknown>;
  if (o.status === 'conflict') return true;
  if (o.conflict === true) return true;
  if (typeof o.conflict === 'object' && o.conflict !== null) return true;
  return false;
}

/** Pull the conflict detail object regardless of which accepted shape Svod used. */
function conflictBody(payload: unknown): Record<string, unknown> {
  const o = payload as Record<string, unknown>;
  if (typeof o.conflict === 'object' && o.conflict !== null) {
    return o.conflict as Record<string, unknown>;
  }
  return o;
}

// --- small helpers -------------------------------------------------------------------------------

/** Drop undefined params so we never send `arguments: { foo: undefined }`. */
function toArgs(params: object): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

function asObject(raw: unknown, tool: string): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new SvodParseError(tool, 'expected a JSON object');
  }
  return raw as Record<string, unknown>;
}

/** Extract a `notes` array from a recall result, tolerating `{ notes: [...] }` or a bare array. */
function extractNotes(raw: unknown, tool: string): SvodNote[] {
  if (Array.isArray(raw)) return raw as SvodNote[];
  const obj = asObject(raw, tool);
  if (Array.isArray(obj.notes)) return obj.notes as SvodNote[];
  if (Array.isArray(obj.results)) return obj.results as SvodNote[];
  throw new SvodParseError(tool, 'expected a notes/results array');
}

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}

function optStr(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function errorMessageOf(payload: unknown, text: string | undefined): string {
  if (typeof payload === 'object' && payload !== null) {
    const o = payload as Record<string, unknown>;
    if (typeof o.error === 'string') return o.error;
    if (typeof o.message === 'string') return o.message;
  }
  return text !== undefined ? truncate(text) : 'unknown error';
}

function truncate(text: string): string {
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}

export type { Revision };
