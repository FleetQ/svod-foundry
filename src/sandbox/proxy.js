// Allowlisting forward proxy for the sandbox egress model (ADR-0003).
//
// Runs as a sidecar container (from the node base image) on a Docker network shared with the
// sandbox workload. The workload's HTTP_PROXY/HTTPS_PROXY point here. This proxy permits HTTP
// forwarding and HTTPS CONNECT tunnels ONLY to hosts on the allowlist passed at launch via the
// ALLOWLIST env var; every other destination is refused. The allowlist is fixed at process
// start — the workload cannot widen it.
//
// No npm deps: stdlib http/net only. Self-contained so it can be mounted read-only and run with
// `node proxy.js`.

'use strict';

/* This is a CommonJS Node script mounted read-only and run by `node proxy.js` inside the proxy
   container — it is NOT compiled with the app's TS. Disable the TS/ESM-oriented lint rules and
   declare the Node runtime globals it relies on. */
/* eslint-disable no-undef, @typescript-eslint/no-require-imports */

const http = require('node:http');
const net = require('node:net');

const PORT = Number(process.env.PROXY_PORT || 8080);
const ALLOWLIST = (process.env.ALLOWLIST || '')
  .split(',')
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

// A host is allowed if it exactly matches an allowlist entry, or is a subdomain of one.
function isAllowed(host) {
  if (!host) return false;
  const h = host.toLowerCase();
  return ALLOWLIST.some((allowed) => h === allowed || h.endsWith('.' + allowed));
}

// Strip a :port suffix to get the bare hostname for allowlist checks.
function hostnameOf(hostport) {
  if (!hostport) return '';
  // IPv6 literal in brackets, e.g. [::1]:443
  if (hostport.startsWith('[')) {
    const end = hostport.indexOf(']');
    return end === -1 ? hostport : hostport.slice(1, end);
  }
  const colon = hostport.lastIndexOf(':');
  return colon === -1 ? hostport : hostport.slice(0, colon);
}

const server = http.createServer((req, res) => {
  // Plain HTTP forward proxy: the absolute-form request-target carries the host.
  let target;
  try {
    target = new URL(req.url);
  } catch {
    res.writeHead(400).end('bad request-target');
    return;
  }
  if (!isAllowed(target.hostname)) {
    res.writeHead(403).end('destination not on egress allowlist');
    return;
  }
  const upstream = http.request(
    {
      host: target.hostname,
      port: target.port || 80,
      method: req.method,
      path: target.pathname + target.search,
      headers: req.headers,
    },
    (upRes) => {
      res.writeHead(upRes.statusCode || 502, upRes.headers);
      upRes.pipe(res);
    },
  );
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502);
    res.end('upstream error');
  });
  req.pipe(upstream);
});

// HTTPS (and any TLS) goes through CONNECT tunneling. We never terminate TLS — we only open a
// raw TCP tunnel to an allowlisted host, so the allowlist is enforced on the SNI-less CONNECT host.
server.on('connect', (req, clientSocket, head) => {
  const host = hostnameOf(req.url);
  const port = Number((req.url.split(':')[1] || '443').trim()) || 443;
  if (!isAllowed(host)) {
    clientSocket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    clientSocket.destroy();
    return;
  }
  const upstream = net.connect(port, host, () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head && head.length) upstream.write(head);
    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
  });
  upstream.on('error', () => clientSocket.destroy());
  clientSocket.on('error', () => upstream.destroy());
});

server.listen(PORT, '0.0.0.0', () => {
  // stderr so it does not pollute any stdout contract.
  console.error(`egress-proxy listening on ${PORT}; allowlist=[${ALLOWLIST.join(', ')}]`);
});
