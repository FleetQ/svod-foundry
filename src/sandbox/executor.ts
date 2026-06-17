// The sandbox executor (ADR-0003): the single, identical path used by both `verify` and `run`.
//
// executeInSandbox() runs an untrusted, machine-generated tool inside an ephemeral Docker
// container with: read-only tool mount, tmpfs scratch, no writable host bind, deny-by-default
// egress (NetworkMode 'none') unless the request declares an egress allowlist, in which case the
// only outbound path is an allowlisting forward-proxy sidecar on an internal network. Resources
// are capped (memory/cpu/pids) and a host-side wall-clock timeout kills the container.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import Docker from 'dockerode';
import type { SandboxRequest, SandboxResult } from '../types.js';
import type { Config } from '../config.js';
import {
  PROXY_PORT,
  buildProxyCreateOptions,
  buildSandboxCreateOptions,
  isNetworkDenied,
} from './spec.js';

/** Construct the dockerode client from Config (socket path, or remote host/port). */
export function createDockerClient(config: Config): Docker {
  if (config.docker.host) {
    return new Docker({ host: config.docker.host, port: config.docker.port });
  }
  return new Docker({ socketPath: config.docker.socketPath });
}

/** Locate proxy.js next to this module — works from src/ (tsx) and from dist/ (built, asset copied). */
export function resolveProxyScriptPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, 'proxy.js'), join(here, '..', '..', 'src', 'sandbox', 'proxy.js')];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  // Fall back to the co-located path; the error surfaces clearly if it is genuinely missing.
  return candidates[0]!;
}

/**
 * Run one untrusted tool execution in a contained, ephemeral Docker container.
 * The identical entry point for `verify` and `run` — they differ only in `request.command`/args.
 */
export async function executeInSandbox(
  request: SandboxRequest,
  config: Config = defaultConfigUnavailable(),
): Promise<SandboxResult> {
  const docker = createDockerClient(config);

  if (isNetworkDenied(request.network)) {
    return runContained(docker, config, request, { networkMode: 'none' });
  }
  return runWithEgressProxy(docker, config, request);
}

/** Execute with NetworkMode already decided and no proxy/network teardown to manage. */
async function runContained(
  docker: Docker,
  config: Config,
  request: SandboxRequest,
  opts: { networkMode: string; proxyEnv?: Record<string, string> },
): Promise<SandboxResult> {
  const createOptions = buildSandboxCreateOptions(request, config, opts);
  const container = await docker.createContainer(createOptions);

  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const outChunks: Buffer[] = [];
  const errChunks: Buffer[] = [];
  stdout.on('data', (c: Buffer) => outChunks.push(c));
  stderr.on('data', (c: Buffer) => errChunks.push(c));

  const stream = await container.attach({
    stream: true,
    stdout: true,
    stderr: true,
  });
  docker.modem.demuxStream(stream, stdout, stderr);

  // Register the stream-drained promise BEFORE starting — otherwise a fast container can emit
  // 'end' before we ever attach the listener, deadlocking the await below.
  const streamDone = new Promise<void>((resolve) => {
    let settled = false;
    const done = (): void => {
      if (settled) return;
      settled = true;
      resolve();
    };
    stream.on('end', done);
    stream.on('close', done);
    stream.on('error', done);
  });

  await container.start();

  let timedOut = false;
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      // Force-kill; do not rely on the in-container process honoring signals. AutoRemove cleans up.
      container.kill({ signal: 'SIGKILL' }).catch(() => {});
      resolve('timeout');
    }, request.limits.timeoutMs);
  });

  let exitCode = -1;
  try {
    // container.wait() resolves with the exit code the instant the container exits (just before
    // AutoRemove reaps it); it can reject if the container is killed/removed under us on the
    // timeout path, so swallow that into undefined.
    const waitResult = await Promise.race([
      container
        .wait()
        .then((r: { StatusCode: number }) => r.StatusCode)
        .catch(() => undefined),
      timeout,
    ]);
    if (typeof waitResult === 'number') exitCode = waitResult;
  } finally {
    if (timer) clearTimeout(timer);
  }

  // Wait for the attach stream to fully drain so stdout/stderr are complete.
  await streamDone;

  return {
    exitCode,
    stdout: Buffer.concat(outChunks).toString('utf8'),
    stderr: Buffer.concat(errChunks).toString('utf8'),
    timedOut,
  };
}

/**
 * Execute with an allowlisting egress proxy: create an internal Docker network (no direct route
 * out for the workload) plus a bridge network for the proxy, launch the proxy sidecar, then run
 * the workload with HTTP(S)_PROXY pointed at the proxy. Tear it all down afterward.
 */
async function runWithEgressProxy(
  docker: Docker,
  config: Config,
  request: SandboxRequest,
): Promise<SandboxResult> {
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const internalNetName = `svod-sbx-int-${suffix}`;
  const proxyName = `svod-sbx-proxy-${suffix}`;

  // Internal network: the workload joins this and has NO route to the outside world.
  const internalNet = await docker.createNetwork({
    Name: internalNetName,
    Internal: true,
    Driver: 'bridge',
    Attachable: true,
  });

  let proxyContainer: Docker.Container | undefined;
  try {
    const proxyOptions = buildProxyCreateOptions(
      config,
      resolveProxyScriptPath(),
      request.network,
      internalNetName,
      request.limits,
    );
    proxyContainer = await docker.createContainer({ ...proxyOptions, name: proxyName });

    // Give the proxy an outbound route via the default bridge — it is the only thing that can
    // reach the internet; the workload's internal network has Internal: true.
    await docker.getNetwork('bridge').connect({ Container: proxyContainer.id });
    await proxyContainer.start();

    // The workload resolves the proxy by container name on the shared internal network.
    const proxyUrl = `http://${proxyName}:${PROXY_PORT}`;
    return await runContained(docker, config, request, {
      networkMode: internalNetName,
      proxyEnv: {
        HTTP_PROXY: proxyUrl,
        HTTPS_PROXY: proxyUrl,
        http_proxy: proxyUrl,
        https_proxy: proxyUrl,
        // Never bypass the proxy for any host.
        NO_PROXY: '',
        no_proxy: '',
      },
    });
  } finally {
    if (proxyContainer) {
      await proxyContainer.kill({ signal: 'SIGKILL' }).catch(() => {});
      await proxyContainer.remove({ force: true }).catch(() => {});
    }
    await internalNet.remove().catch(() => {});
  }
}

// executeInSandbox requires a real Config. This guard makes the missing-config case a clear error
// rather than a confusing dockerode failure if a caller forgets to pass one.
function defaultConfigUnavailable(): never {
  throw new Error('executeInSandbox requires a Config argument');
}
