#!/usr/bin/env node
// Generic CORS proxy for upstream video sources.
// URL scheme: GET /{hostname}/path  →  https://{hostname}/path
// Usage: node proxy.js   (listens on PROXY_PORT, default 8788)
const http = require('http');
const https = require('https');

const PROXY_PORT = parseInt(process.env.PROXY_PORT, 10) || 8788;
// Generous timeout: covers agent queue wait time + actual transfer at maxSockets cap.
const PROXY_TIMEOUT_MS = parseInt(process.env.PROXY_TIMEOUT_MS, 10) || 60_000;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 500;

// Only proxy hostnames that are evideo.bg or a subdomain of it.
const ALLOWED_APEX = process.env.PROXY_ALLOWED_APEX || 'evideo.bg';
function isAllowedHost(hostname) {
  return hostname === ALLOWED_APEX || hostname.endsWith('.' + ALLOWED_APEX);
}

// keepAlive + LIFO: reuses recently-freed sockets (least stale) and lets old
// ones age out naturally. maxSockets bounds upstream concurrency to avoid RSTs
// under load; maxFreeSockets caps the idle pool size.
const agent = new https.Agent({
  keepAlive: true,
  scheduling: 'lifo',
  maxSockets: 64,
  maxFreeSockets: 16,
});

const STRIP_UPSTREAM_HEADERS = new Set([
  'content-security-policy',  // would apply to volunteer page context
  'x-frame-options',
  'strict-transport-security',
]);

http.createServer((req, res) => {
  res.on('error', () => {}); // prevent uncaught emit when client disconnects

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, HEAD',
      'access-control-allow-headers': 'range',
    });
    res.end();
    return;
  }

  // Extract hostname from first path segment: /{hostname}/rest
  const slashIdx = req.url.indexOf('/', 1);
  const hostname = slashIdx === -1 ? req.url.slice(1) : req.url.slice(1, slashIdx);
  const remotePath = slashIdx === -1 ? '/' : req.url.slice(slashIdx);

  if (!hostname || !isAllowedHost(hostname)) {
    res.writeHead(403);
    res.end(`Host not allowed: ${hostname}`);
    return;
  }

  // For bodyless methods use proxyReq.end() directly — req stream is already
  // consumed after first attempt, so req.pipe() on a retry silently does nothing,
  // leaving the upstream socket hanging and eventually poisoning the agent pool.
  const isBodyless = req.method === 'GET' || req.method === 'HEAD';

  let proxyReqRef = null;
  req.on('close', () => {
    if (proxyReqRef && !proxyReqRef.destroyed) proxyReqRef.destroy();
  });

  function attempt(retriesLeft) {
    const upstreamHeaders = { ...req.headers, host: hostname };
    delete upstreamHeaders['origin'];
    delete upstreamHeaders['referer'];

    const proxyReq = https.request({
      agent,
      hostname,
      path: remotePath,
      method: req.method,
      headers: upstreamHeaders,
      timeout: PROXY_TIMEOUT_MS,
    }, (proxyRes) => {
      const headers = {};
      for (const [k, v] of Object.entries(proxyRes.headers)) {
        if (STRIP_UPSTREAM_HEADERS.has(k.toLowerCase())) continue;
        // Strip content-length on non-206: if upstream drops mid-stream the
        // browser would get ERR_CONTENT_LENGTH_MISMATCH. Keep it for 206 so
        // Range requests work correctly for video seeking.
        if (k.toLowerCase() === 'content-length' && proxyRes.statusCode !== 206) continue;
        headers[k] = v;
      }
      headers['access-control-allow-origin'] = '*';
      headers['access-control-expose-headers'] = 'content-length, content-range, accept-ranges';

      res.writeHead(proxyRes.statusCode, headers);

      proxyRes.on('error', (err) => {
        if (err.message === 'aborted') return; // self-inflicted via proxyReq.destroy()
        if (!res.destroyed) res.destroy();
      });

      proxyRes.pipe(res, { end: true });
    });

    proxyReqRef = proxyReq;

    proxyReq.on('timeout', () => {
      proxyReq.destroy(); // triggers 'error' with ECONNRESET/ETIMEDOUT → retry path
    });

    proxyReq.on('error', (err) => {
      if (err.code === 'ERR_STREAM_DESTROYED') return; // we destroyed it ourselves

      const retryable =
        err.code === 'ECONNRESET' ||
        err.code === 'ETIMEDOUT' ||
        err.message === 'socket hang up';

      if (retryable && retriesLeft > 0 && !res.headersSent) {
        setTimeout(() => attempt(retriesLeft - 1), RETRY_DELAY_MS);
        return;
      }

      // Only log final failures — intermediate retries are expected noise.
      console.error(`Proxy error [${err.code || err.message}] → ${hostname}${remotePath}`);
      if (!res.headersSent) { res.writeHead(502); }
      if (!res.destroyed) res.end(err.message);
    });

    if (isBodyless) {
      proxyReq.end();
    } else {
      req.pipe(proxyReq, { end: true });
    }
  }

  attempt(MAX_RETRIES);
}).listen(PROXY_PORT, () => {
  console.log(`CORS proxy :${PROXY_PORT}  allowed apex: ${ALLOWED_APEX} (and subdomains)`);
});
