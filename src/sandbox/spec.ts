// Pure spec-building helpers for the sandbox executor (ADR-0003).
//
// These functions construct the dockerode container-create options from a SandboxRequest
// WITHOUT touching the Docker daemon, so the container contract (no host FS, deny-by-default
// egress, resource caps) is unit-testable in isolation. The executor (./executor.ts) calls
// these and then hands the result to dockerode.

import type Docker from 'dockerode';
import type { SandboxLimits, SandboxRequest, Runtime } from '../types.js';
import type { Config } from '../config.js';

/** Where the read-only tool dir is mounted inside the container. */
export const TOOL_MOUNT = '/tool';
/** tmpfs scratch working dir inside the container. */
export const WORK_DIR = '/work';
/** Port the egress proxy sidecar listens on. */
export const PROXY_PORT = 8080;
/** Where the inline proxy script is mounted (read-only) in the proxy container. */
export const PROXY_SCRIPT_MOUNT = '/proxy/proxy.js';

/**
 * Parse a Docker-style memory string ("256m", "1g", "512k", "1048576b", or a bare byte count)
 * into bytes. Throws on a malformed value rather than silently under-limiting memory.
 */
export function parseMemoryToBytes(memory: string): number {
  const match = /^(\d+(?:\.\d+)?)\s*([bkmg])?$/i.exec(memory.trim());
  if (!match) {
    throw new Error(`invalid memory limit: ${JSON.stringify(memory)} (expected e.g. "256m", "1g")`);
  }
  const value = Number(match[1]);
  const unit = (match[2] ?? 'b').toLowerCase();
  const multiplier =
    unit === 'g' ? 1024 ** 3 : unit === 'm' ? 1024 ** 2 : unit === 'k' ? 1024 : 1;
  return Math.floor(value * multiplier);
}

/** Convert fractional CPU cores (e.g. 0.5, 1, 2) to dockerode's NanoCpus (1 core = 1e9). */
export function cpusToNanoCpus(cpus: number): number {
  return Math.floor(cpus * 1e9);
}

/** True when the request declares no egress => the container must get NetworkMode 'none'. */
export function isNetworkDenied(network: readonly string[]): boolean {
  return network.length === 0;
}

/** Resolve the fixed base image for a runtime from config (ADR-0003). */
export function baseImageFor(config: Config, runtime: Runtime): string {
  return config.docker.baseImages[runtime];
}

/**
 * Build the dockerode container-create options for the sandbox (workload) container.
 *
 * `networkMode` is passed explicitly because the executor decides it: 'none' for a denied request,
 * or the name of the internal Docker network shared with the egress proxy for an allowlisted one.
 * When a proxy is in play, `proxyEnv` carries the HTTP(S)_PROXY values pointing the workload at it.
 */
export function buildSandboxCreateOptions(
  request: SandboxRequest,
  config: Config,
  opts: { networkMode: string; proxyEnv?: Record<string, string> },
): Docker.ContainerCreateOptions {
  const env = Object.entries(opts.proxyEnv ?? {}).map(([k, v]) => `${k}=${v}`);

  return {
    Image: baseImageFor(config, request.runtime),
    Cmd: request.command,
    WorkingDir: WORK_DIR,
    Env: env.length > 0 ? env : undefined,
    // Tty off so stdout and stderr stay multiplexed on one stream and can be demuxed apart.
    Tty: false,
    // Run as an unprivileged uid:gid. Both base images tolerate an arbitrary non-root uid for
    // simply executing a script out of a world-readable mount into tmpfs scratch.
    User: '65534:65534',
    HostConfig: buildHostConfig(request, opts.networkMode),
  };
}

/** Build just the HostConfig — the part that carries every containment control. */
export function buildHostConfig(
  request: SandboxRequest,
  networkMode: string,
): Docker.ContainerCreateOptions['HostConfig'] {
  const { toolDir, limits } = request;
  return {
    AutoRemove: true,
    // Tool dir is the only host path exposed, and it is read-only. No writable host bind mount.
    Binds: [`${toolDir}:${TOOL_MOUNT}:ro`],
    // The whole container root is read-only; the only writable surface is the tmpfs scratch below.
    ReadonlyRootfs: true,
    Tmpfs: { [WORK_DIR]: 'rw,noexec,nosuid,size=64m' },
    NetworkMode: networkMode,
    Memory: parseMemoryToBytes(limits.memory),
    NanoCpus: cpusToNanoCpus(limits.cpus),
    PidsLimit: limits.pidsLimit,
    // Drop every Linux capability and forbid privilege escalation.
    CapDrop: ['ALL'],
    SecurityOpt: ['no-new-privileges'],
  };
}

/** Build the create options for the egress-proxy sidecar (only used when egress is allowlisted). */
export function buildProxyCreateOptions(
  config: Config,
  proxyScriptHostPath: string,
  allowlist: readonly string[],
  networkName: string,
  limits: SandboxLimits,
): Docker.ContainerCreateOptions {
  return {
    // Reuse the node base image — no extra image to pull or maintain (ADR-0003 recommended design).
    Image: config.docker.baseImages.node,
    Cmd: ['node', PROXY_SCRIPT_MOUNT],
    Env: [`PROXY_PORT=${PROXY_PORT}`, `ALLOWLIST=${allowlist.join(',')}`],
    ExposedPorts: { [`${PROXY_PORT}/tcp`]: {} },
    User: '65534:65534',
    HostConfig: {
      AutoRemove: true,
      Binds: [`${proxyScriptHostPath}:${PROXY_SCRIPT_MOUNT}:ro`],
      ReadonlyRootfs: true,
      // The proxy attaches to the internal network here; the executor also connects it to a
      // bridge network so it (and only it) has an outbound route.
      NetworkMode: networkName,
      Memory: parseMemoryToBytes(limits.memory),
      NanoCpus: cpusToNanoCpus(limits.cpus),
      PidsLimit: limits.pidsLimit,
      CapDrop: ['ALL'],
      SecurityOpt: ['no-new-privileges'],
    },
  };
}
