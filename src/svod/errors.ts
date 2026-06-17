// Typed errors for the Svod MCP client wrapper.

import type { Revision } from './types.js';

/** Base class for every error this wrapper raises, so callers can `instanceof SvodError`. */
export class SvodError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * Optimistic-concurrency conflict. A `write`/`promote` whose `expectedRevision` is stale does NOT
 * blind-overwrite: Svod returns a structured conflict carrying the *current* content + revision, and
 * the wrapper surfaces it as this typed error so the caller can re-read / merge / retry.
 *
 * `currentContent` may be undefined if Svod reports the conflict without inlining the current body
 * (the caller should then `read(path)` to fetch it).
 */
export class SvodConflictError extends SvodError {
  readonly path: string;
  readonly currentRevision: Revision;
  readonly currentContent: string | undefined;

  constructor(args: { path: string; currentRevision: Revision; currentContent?: string }) {
    super(
      `optimistic-concurrency conflict on ${args.path}: current revision is ${args.currentRevision}`,
    );
    this.path = args.path;
    this.currentRevision = args.currentRevision;
    this.currentContent = args.currentContent;
  }
}

/** A Svod tool reported an application-level error (MCP `isError: true`, or a parseable error body). */
export class SvodToolError extends SvodError {
  readonly tool: string;
  constructor(tool: string, message: string) {
    super(`svod tool ${tool} failed: ${message}`);
    this.tool = tool;
  }
}

/** A tool result could not be parsed into the expected shape (defensive boundary at the MCP edge). */
export class SvodParseError extends SvodError {
  readonly tool: string;
  constructor(tool: string, message: string) {
    super(`could not parse svod ${tool} result: ${message}`);
    this.tool = tool;
  }
}
