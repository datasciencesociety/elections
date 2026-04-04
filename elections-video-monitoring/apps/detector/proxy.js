#!/usr/bin/env node
// CORS proxy for archive.evideo.bg
// Routes video requests through localhost so canvas.getImageData() is not blocked.
// Usage: node proxy.js   (listens on port 8788)
const http = require('http');
const https = require('https');

const TARGET_HOST = 'archive.evideo.bg';
const PROXY_PORT = 8788;

http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, HEAD',
      'access-control-allow-headers': 'range',
    });
    res.end();
    return;
  }

  const upstreamHeaders = { ...req.headers, host: TARGET_HOST };
  delete upstreamHeaders['origin'];
  delete upstreamHeaders['referer'];

  const options = {
    hostname: TARGET_HOST,
    path: req.url,
    method: req.method,
    headers: upstreamHeaders,
  };

  const proxyReq = https.request(options, (proxyRes) => {
    const headers = {
      ...proxyRes.headers,
      'access-control-allow-origin': '*',
      'access-control-expose-headers': 'content-length, content-range, accept-ranges',
    };
    res.writeHead(proxyRes.statusCode, headers);
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.on('error', (err) => {
    console.error('Proxy error:', err.message);
    if (!res.headersSent) { res.writeHead(502); }
    res.end(err.message);
  });

  req.pipe(proxyReq, { end: true });
}).listen(PROXY_PORT, () => {
  console.log(`CORS proxy: http://localhost:${PROXY_PORT}  →  https://${TARGET_HOST}`);
});
