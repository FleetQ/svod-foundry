// Public surface of the Svod MCP client wrapper (Milestone 2).

export { SvodClient } from './client.js';
export type { McpClientLike, SvodClientOptions } from './client.js';
export { SvodError, SvodConflictError, SvodToolError, SvodParseError } from './errors.js';
export type * from './types.js';
