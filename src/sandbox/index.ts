// Public surface of the sandbox executor (ADR-0003). `verify` and `run` both call
// executeInSandbox — the single, identical contained-execution path.

export { executeInSandbox, createDockerClient } from './executor.js';
export {
  buildSandboxCreateOptions,
  buildHostConfig,
  buildProxyCreateOptions,
  parseMemoryToBytes,
  cpusToNanoCpus,
  isNetworkDenied,
  baseImageFor,
  TOOL_MOUNT,
  WORK_DIR,
} from './spec.js';
