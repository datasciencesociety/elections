'use strict';
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

// ── DB ────────────────────────────────────────────────────────────────────────

const DB_PATH      = process.env.DB_PATH      || path.join(__dirname, 'data', 'streams.db');
const DETECTOR_DIR = process.env.DETECTOR_DIR || path.join(__dirname, '../detector');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS streams (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    url          TEXT NOT NULL,
    label        TEXT NOT NULL,
    last_checked INTEGER DEFAULT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id             TEXT PRIMARY KEY,
    assigned_at    INTEGER NOT NULL,
    last_heartbeat INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS assignments (
    session_id  TEXT    NOT NULL,
    stream_id   INTEGER NOT NULL,
    assigned_at INTEGER NOT NULL,
    PRIMARY KEY (session_id, stream_id)
  );

  CREATE TABLE IF NOT EXISTS reports (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  TEXT    NOT NULL,
    stream_id   INTEGER NOT NULL,
    ts          INTEGER NOT NULL,
    status      TEXT    NOT NULL,
    cover_ratio REAL,
    frozen_sec  REAL,
    luma        REAL
  );

  CREATE INDEX IF NOT EXISTS idx_reports_stream_ts  ON reports(stream_id, ts);
  CREATE INDEX IF NOT EXISTS idx_reports_session    ON reports(session_id);
  CREATE INDEX IF NOT EXISTS idx_streams_checked    ON streams(last_checked);
  CREATE INDEX IF NOT EXISTS idx_assignments_sess   ON assignments(session_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_hb        ON sessions(last_heartbeat);
`);

// ── Prepared statements ───────────────────────────────────────────────────────

const stmt = {
  insertSession:     db.prepare('INSERT INTO sessions VALUES (?, ?, ?)'),
  pickStreams:       db.prepare(`
    SELECT id, url, label FROM streams
    ORDER BY last_checked IS NOT NULL, last_checked ASC
    LIMIT 16
  `),
  insertAssignment:  db.prepare('INSERT OR REPLACE INTO assignments VALUES (?, ?, ?)'),
  heartbeat:         db.prepare('UPDATE sessions SET last_heartbeat = ? WHERE id = ?'),
  deadSessions:      db.prepare('SELECT id FROM sessions WHERE last_heartbeat < ?'),
  deleteSession:     db.prepare('DELETE FROM sessions WHERE id = ?'),
  deleteAssignments: db.prepare('DELETE FROM assignments WHERE session_id = ?'),
  sessionExists:     db.prepare('SELECT 1 FROM sessions WHERE id = ?'),
  insertReport:      db.prepare(`
    INSERT INTO reports (session_id, stream_id, ts, status, cover_ratio, frozen_sec, luma)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `),
  touchStream:       db.prepare('UPDATE streams SET last_checked = ? WHERE id = ?'),
  flagged:           db.prepare(`
    SELECT
      s.id    AS stream_id,
      s.url,
      s.label,
      r.status AS flag_type,
      MIN(r.ts) AS first_seen,
      COUNT(DISTINCT r.session_id) AS report_count
    FROM reports r
    JOIN streams s ON s.id = r.stream_id
    WHERE r.ts > ?
      AND r.status != 'ok'
      AND r.status != 'loading'
      AND r.status != 'initializing'
      AND r.status != 'error'
    GROUP BY s.id, r.status
    HAVING COUNT(DISTINCT r.session_id) >= 2
    ORDER BY report_count DESC, first_seen ASC
  `),
  volunteerCount:    db.prepare('SELECT COUNT(*) AS count FROM sessions WHERE last_heartbeat > ?'),
  insertStream:      db.prepare('INSERT INTO streams (url, label) VALUES (?, ?)'),
};

// node:sqlite has no .transaction() helper — wrap with manual BEGIN/COMMIT
function transaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function txCreateSession(sessionId, streams) {
  transaction(() => {
    const now = Date.now();
    stmt.insertSession.run(sessionId, now, now);
    for (const s of streams) {
      stmt.insertAssignment.run(sessionId, s.id, now);
    }
  });
}

function txReport(sessionId, results, now) {
  transaction(() => {
    for (const r of results) {
      stmt.insertReport.run(sessionId, r.stream_id, now, r.status,
        r.cover_ratio ?? null, r.frozen_sec ?? null, r.luma ?? null);
      stmt.touchStream.run(now, r.stream_id);
    }
  });
}

function txBulkUpload(streams) {
  return transaction(() => {
    db.exec('DELETE FROM reports');
    db.exec('DELETE FROM assignments');
    db.exec('DELETE FROM sessions');
    db.exec('DELETE FROM streams');
    for (const { url, label } of streams) {
      stmt.insertStream.run(url, String(label));
    }
    return streams.length;
  });
}

function txCleanDead(cutoff) {
  return transaction(() => {
    const dead = stmt.deadSessions.all(cutoff);
    for (const { id } of dead) {
      stmt.deleteAssignments.run(id);
      stmt.deleteSession.run(id);
    }
    return dead.length;
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > 20 * 1024 * 1024) { reject(new Error('Body too large')); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(payload);
}

function serveFile(res, filePath, contentType) {
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

// ── CORS Proxy ────────────────────────────────────────────────────────────────

const TARGET_HOST = 'archive.evideo.bg';

function handleProxy(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, HEAD',
      'access-control-allow-headers': 'range',
    });
    res.end();
    return;
  }

  const remotePath = req.url.slice('/proxy'.length); // keeps leading /
  const upstreamHeaders = { ...req.headers, host: TARGET_HOST };
  delete upstreamHeaders['origin'];
  delete upstreamHeaders['referer'];

  const proxyReq = https.request({
    hostname: TARGET_HOST,
    path: remotePath,
    method: req.method,
    headers: upstreamHeaders,
  }, (proxyRes) => {
    const responseHeaders = {
      ...proxyRes.headers,
      'access-control-allow-origin': '*',
      'access-control-expose-headers': 'content-length, content-range, accept-ranges',
    };
    res.writeHead(proxyRes.statusCode, responseHeaders);
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.on('error', (err) => {
    console.error('Proxy error:', err.message);
    if (!res.headersSent) res.writeHead(502);
    res.end();
  });

  req.pipe(proxyReq, { end: true });
}

// ── Route handlers ────────────────────────────────────────────────────────────

async function handleSession(req, res) {
  const sessionId = crypto.randomUUID();
  const streams = stmt.pickStreams.all();
  txCreateSession(sessionId, streams);
  json(res, 200, { session_id: sessionId, streams });
}

async function handleHeartbeat(req, res) {
  const body = await readBody(req);
  const { session_id } = body;
  if (!session_id) { json(res, 400, { error: 'session_id required' }); return; }

  const now = Date.now();
  stmt.heartbeat.run(now, session_id);
  const cleaned = txCleanDead(now - 120_000);
  if (cleaned > 0) console.log(`Cleaned ${cleaned} dead session(s)`);
  json(res, 200, { ok: true });
}

async function handleReport(req, res) {
  const body = await readBody(req);
  const { session_id, results } = body;
  if (!session_id || !Array.isArray(results)) {
    json(res, 400, { error: 'session_id and results[] required' }); return;
  }
  if (!stmt.sessionExists.get(session_id)) {
    json(res, 400, { error: 'unknown session' }); return;
  }
  txReport(session_id, results, Date.now());
  json(res, 200, { ok: true });
}

function handleFlagged(req, res) {
  const cutoff = Date.now() - 300_000; // 5 min
  const flagged = stmt.flagged.all(cutoff);
  const { count } = stmt.volunteerCount.get(Date.now() - 120_000);
  json(res, 200, { flagged, volunteer_count: count });
}

async function handleStreamsUpload(req, res) {
  let body;
  try { body = await readBody(req); }
  catch (e) { json(res, 400, { error: e.message }); return; }

  if (!Array.isArray(body)) {
    json(res, 400, { error: 'Expected JSON array [{url, label}]' }); return;
  }
  const valid = body.filter(s => s && typeof s.url === 'string' && s.url.trim());
  if (valid.length === 0) { json(res, 400, { error: 'No valid streams' }); return; }

  const inserted = txBulkUpload(valid);
  console.log(`Uploaded ${inserted} streams`);
  json(res, 200, { inserted });
}

// ── HTTP server ───────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];

  try {
    // Static pages
    if (req.method === 'GET' && url === '/') {
      serveFile(res, path.join(__dirname, 'public', 'volunteer.html'), 'text/html; charset=utf-8');
      return;
    }
    if (req.method === 'GET' && url === '/admin') {
      serveFile(res, path.join(__dirname, 'public', 'admin.html'), 'text/html; charset=utf-8');
      return;
    }
    if (req.method === 'GET' && url === '/poc') {
      serveFile(res, path.join(__dirname, 'public', 'poc.html'), 'text/html; charset=utf-8');
      return;
    }
    if (req.method === 'GET' && url === '/inspect') {
      res.writeHead(301, { Location: '/inspect/' }); res.end(); return;
    }
    if (req.method === 'GET' && url === '/inspect/') {
      serveFile(res, path.join(DETECTOR_DIR, 'index.html'), 'text/html; charset=utf-8');
      return;
    }
    if (req.method === 'GET' && url.startsWith('/inspect/') && url.endsWith('.js')) {
      serveFile(res, path.join(DETECTOR_DIR, path.basename(url)), 'application/javascript; charset=utf-8');
      return;
    }
    if (req.method === 'GET' && url === '/inspect/style.css') {
      serveFile(res, path.join(DETECTOR_DIR, 'style.css'), 'text/css; charset=utf-8');
      return;
    }
    if (req.method === 'GET' && url.endsWith('.js')) {
      serveFile(res, path.join(__dirname, 'public', path.basename(url)), 'application/javascript; charset=utf-8');
      return;
    }

    // CORS proxy
    if (url.startsWith('/proxy/')) {
      handleProxy(req, res);
      return;
    }

    // API
    if (req.method === 'POST' && url === '/api/session') {
      await handleSession(req, res); return;
    }
    if (req.method === 'POST' && url === '/api/heartbeat') {
      await handleHeartbeat(req, res); return;
    }
    if (req.method === 'POST' && url === '/api/report') {
      await handleReport(req, res); return;
    }
    if (req.method === 'GET' && url === '/api/flagged') {
      handleFlagged(req, res); return;
    }
    if (req.method === 'GET' && url === '/api/streams/count') {
      const { count } = db.prepare('SELECT COUNT(*) AS count FROM streams').get();
      json(res, 200, { count }); return;
    }
    if (req.method === 'POST' && url === '/api/streams') {
      await handleStreamsUpload(req, res); return;
    }

    res.writeHead(404); res.end();
  } catch (err) {
    console.error('Request error:', err);
    if (!res.headersSent) json(res, 500, { error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Election monitor: http://localhost:${PORT}`));
