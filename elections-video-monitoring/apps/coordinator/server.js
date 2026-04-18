'use strict';
const http = require('http');
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
    section      TEXT,
    url          TEXT NOT NULL,
    label        TEXT NOT NULL,
    enabled      INTEGER NOT NULL DEFAULT 1,
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

// ── Migrate existing DB (add columns if missing) ─────────────────────────────
try { db.exec('ALTER TABLE streams ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1'); } catch {}
try { db.exec('ALTER TABLE streams ADD COLUMN section TEXT'); } catch {}
// Backfill section from URL for existing rows: extract 9-digit number from /real/XXXXXXXXX/
db.exec(`
  UPDATE streams SET section = substr(url,
    instr(url, '/real/') + 6,
    9
  ) WHERE section IS NULL AND instr(url, '/real/') > 0
`);
// Fallback: use rowid for any rows where extraction failed
db.exec(`UPDATE streams SET section = CAST(id AS TEXT) WHERE section IS NULL`);
try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_streams_section ON streams(section)'); } catch {}
try { db.exec('ALTER TABLE streams ADD COLUMN assigned_users TEXT'); } catch {}
// rename old column if it exists from a previous run
try { db.exec('ALTER TABLE streams RENAME COLUMN allowed_users TO assigned_users'); } catch {}
try { db.exec('ALTER TABLE sessions ADD COLUMN user_id TEXT'); } catch {}

// ── Prepared statements ───────────────────────────────────────────────────────

const stmt = {
  insertSession:     db.prepare('INSERT INTO sessions (id, assigned_at, last_heartbeat, user_id) VALUES (?, ?, ?, ?)'),
  // pickStreams is dynamic — see pickStreamsForSession()
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
  insertStream:      db.prepare('INSERT INTO streams (section, url, label, assigned_users) VALUES (?, ?, ?, ?)'),
  upsertStream:      db.prepare(`
    INSERT INTO streams (section, url, label, assigned_users) VALUES (?, ?, ?, ?)
    ON CONFLICT(section) DO UPDATE SET url = excluded.url, label = excluded.label, assigned_users = excluded.assigned_users, last_checked = NULL
  `),
  streamStats:       db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN s.enabled = 1 THEN 1 ELSE 0 END) AS enabled,
      SUM(CASE WHEN a.stream_id IS NOT NULL THEN 1 ELSE 0 END) AS covered
    FROM streams s
    LEFT JOIN (
      SELECT DISTINCT a2.stream_id
      FROM assignments a2
      JOIN sessions se ON se.id = a2.session_id AND se.last_heartbeat > ?
    ) a ON a.stream_id = s.id
  `),
  toggleStream:      db.prepare('UPDATE streams SET enabled = ? WHERE id = ?'),
  allStreams:        db.prepare('SELECT id, section, label, url, enabled, assigned_users FROM streams ORDER BY section'),
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

function txCreateSession(sessionId, streams, userId = null) {
  transaction(() => {
    const now = Date.now();
    stmt.insertSession.run(sessionId, now, now, userId);
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

// Extract section number from URL path: .../real/102700005/...
function extractSection(url) {
  const m = url.match(/\/([0-9]{9})\//);  return m ? m[1] : null;
}

function txBulkUpload(streams) {
  return transaction(() => {
    db.exec('DELETE FROM reports');
    db.exec('DELETE FROM assignments');
    db.exec('DELETE FROM sessions');
    db.exec('DELETE FROM streams');
    for (const s of streams) {
      const section = s.section || extractSection(s.url) || String(s.label);
      stmt.insertStream.run(section, s.url, String(s.label), s.assigned_users || null);
    }
    return streams.length;
  });
}

function txUpsertStreams(streams) {
  return transaction(() => {
    let inserted = 0, updated = 0;
    for (const s of streams) {
      const section = s.section || extractSection(s.url) || String(s.label);
      const existing = db.prepare('SELECT url FROM streams WHERE section = ?').get(section);
      stmt.upsertStream.run(section, s.url, String(s.label), s.assigned_users || null);
      if (existing) { if (existing.url !== s.url) updated++; }
      else inserted++;
    }
    return { inserted, updated };
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

// ── Route handlers ────────────────────────────────────────────────────────────

// Pick streams for a new volunteer.
// Priority order:
//   1. Sections pre-assigned to this userId (assigned_users contains the ID) that have no active coverage
//   2. Other unassigned sections (not currently watched by any live session)
//   3. Fallback: least-recently-checked sections regardless of assignment (when pool is small)
// TODO: replace userId stub with real user ID from auth
function pickStreamsForSession(activeCutoff, limit = 16, userId = null) {
  const activeSub = `
    SELECT a.stream_id FROM assignments a
    JOIN sessions se ON se.id = a.session_id
    WHERE se.last_heartbeat > ?
  `;

  // 1. Pre-assigned sections for this user, not currently covered
  let prioritized = [];
  if (userId) {
    prioritized = db.prepare(`
      SELECT s.id, s.url, s.label, s.section, s.assigned_users FROM streams s
      WHERE s.enabled = 1
        AND s.id NOT IN (${activeSub})
        AND s.assigned_users IS NOT NULL
        AND (',' || s.assigned_users || ',') LIKE ('%,' || ? || ',%')
      ORDER BY s.last_checked IS NOT NULL, s.last_checked ASC, RANDOM()
      LIMIT ?
    `).all(activeCutoff, userId, limit);
  }

  if (prioritized.length >= limit) return prioritized;

  // 2. Other unassigned sections (exclude already-picked)
  const excl1 = prioritized.map(s => s.id);
  const ph1 = excl1.length ? excl1.map(() => '?').join(',') : 'NULL';
  const unassigned = db.prepare(`
    SELECT s.id, s.url, s.label, s.section, s.assigned_users FROM streams s
    WHERE s.enabled = 1
      AND s.id NOT IN (${activeSub})
      AND s.id NOT IN (${ph1})
    ORDER BY s.last_checked IS NOT NULL, s.last_checked ASC, RANDOM()
    LIMIT ?
  `).all(activeCutoff, ...excl1, limit - prioritized.length);

  const picked = [...prioritized, ...unassigned];
  if (picked.length >= limit) return picked;

  // 3. Pad with least-recently-checked (pool exhausted — all sections already covered)
  const excl2 = picked.map(s => s.id);
  const ph2 = excl2.length ? excl2.map(() => '?').join(',') : 'NULL';
  const extra = db.prepare(`
    SELECT s.id, s.url, s.label, s.section, s.assigned_users FROM streams s
    WHERE s.enabled = 1
      AND s.id NOT IN (${ph2})
    ORDER BY s.last_checked IS NOT NULL, s.last_checked ASC, RANDOM()
    LIMIT ?
  `).all(...excl2, limit - picked.length);

  return [...picked, ...extra];
}

const SESSION_TTL = parseInt(process.env.SESSION_TTL_MS, 10) || 8 * 60 * 60 * 1000; // 8 h default

// Returns assigned-to-user streams not already present in existingIds.
function missingAssignedStreams(existingIds, userId) {
  if (!userId) return [];
  const ph = existingIds.length ? existingIds.map(() => '?').join(',') : 'NULL';
  return db.prepare(`
    SELECT s.id, s.url, s.label, s.section, s.assigned_users FROM streams s
    WHERE s.enabled = 1
      AND s.assigned_users IS NOT NULL
      AND (',' || s.assigned_users || ',') LIKE ('%,' || ? || ',%')
      AND s.id NOT IN (${ph})
  `).all(userId, ...existingIds);
}

async function handleSession(req, res) {
  let body = {};
  try { body = await readBody(req); } catch {}

  // Resume existing session if the client sends a known session_id
  if (body.session_id && stmt.sessionExists.get(body.session_id)) {
    stmt.heartbeat.run(Date.now(), body.session_id);
    const userId = body.user_id || null;

    // Recompute the correct stream list (same logic as fresh session)
    let streams = userId ? db.prepare(`
      SELECT s.id, s.url, s.label, s.section, s.assigned_users FROM streams s
      WHERE s.enabled = 1
        AND s.assigned_users IS NOT NULL
        AND (',' || s.assigned_users || ',') LIKE ('%,' || ? || ',%')
      ORDER BY s.section ASC
    `).all(userId) : [];

    if (streams.length === 0) {
      // No assigned streams — keep whatever the session already had
      streams = db.prepare(`
        SELECT s.id, s.url, s.label, s.section, s.assigned_users FROM streams s
        JOIN assignments a ON a.stream_id = s.id
        WHERE a.session_id = ?
      `).all(body.session_id);
    } else {
      // Replace session assignments to match exactly the assigned set
      const now = Date.now();
      transaction(() => {
        db.prepare('DELETE FROM assignments WHERE session_id = ?').run(body.session_id);
        for (const s of streams) stmt.insertAssignment.run(body.session_id, s.id, now);
      });
    }

    json(res, 200, { session_id: body.session_id, streams, resumed: true });
    return;
  }

  const userId = body.user_id || null;

  // All sections pre-assigned to this user; if none, pick 2 random enabled streams
  let streams = userId ? db.prepare(`
    SELECT s.id, s.url, s.label, s.section, s.assigned_users FROM streams s
    WHERE s.enabled = 1
      AND s.assigned_users IS NOT NULL
      AND (',' || s.assigned_users || ',') LIKE ('%,' || ? || ',%')
    ORDER BY s.section ASC
  `).all(userId) : [];

  if (streams.length === 0) {
    streams = db.prepare(`
      SELECT s.id, s.url, s.label, s.section, s.assigned_users FROM streams s
      WHERE s.enabled = 1
      ORDER BY RANDOM() LIMIT 2
    `).all();
  }

  const sessionId = crypto.randomUUID();
  txCreateSession(sessionId, streams, body.user_id || null);
  json(res, 200, { session_id: sessionId, streams });
}

async function handleHeartbeat(req, res) {
  const body = await readBody(req);
  const { session_id } = body;
  if (!session_id) { json(res, 400, { error: 'session_id required' }); return; }

  if (!stmt.sessionExists.get(session_id)) {
    // Session expired or was never created — tell client to reinitialise
    json(res, 200, { ok: false, reinit: true });
    return;
  }

  const now = Date.now();
  stmt.heartbeat.run(now, session_id);
  const cleaned = txCleanDead(now - SESSION_TTL);
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
    json(res, 400, { error: 'unknown session', reinit: true }); return;
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

async function handleStreamsUpsert(req, res) {
  let body;
  try { body = await readBody(req); }
  catch (e) { json(res, 400, { error: e.message }); return; }

  if (!Array.isArray(body)) {
    json(res, 400, { error: 'Expected JSON array [{url, label}]' }); return;
  }
  const valid = body.filter(s => s && typeof s.url === 'string' && s.url.trim() && typeof s.label === 'string' && s.label.trim());
  if (valid.length === 0) { json(res, 400, { error: 'No valid streams' }); return; }

  const { inserted, updated } = txUpsertStreams(valid);
  console.log(`Upserted streams: ${inserted} new, ${updated} updated URLs`);
  json(res, 200, { inserted, updated });
}

function handleStreamStats(req, res) {
  const cutoff = Date.now() - 120_000;
  const stats = stmt.streamStats.get(cutoff);
  const { count } = stmt.volunteerCount.get(cutoff);
  json(res, 200, { total: stats.total, enabled: stats.enabled, covered: stats.covered, volunteers: count });
}

function handleStreamsList(req, res) {
  const streams = stmt.allStreams.all();
  json(res, 200, { streams });
}

async function handleStreamToggle(req, res) {
  const body = await readBody(req);
  const { id, enabled } = body;
  if (typeof id !== 'number' || (enabled !== 0 && enabled !== 1)) {
    json(res, 400, { error: 'id (number) and enabled (0|1) required' }); return;
  }
  stmt.toggleStream.run(enabled, id);
  json(res, 200, { ok: true });
}

// ── HTTP server ───────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];

  try {
    // Static pages
    if (req.method === 'GET' && url === '/') {
      // Inject PROXY_BASE so the client knows where to send video requests.
      // PROXY_URL env var must be set (e.g. http://localhost:8788).
      const proxyBase = process.env.PROXY_URL;
      if (!proxyBase) {
        res.writeHead(500);
        res.end('Server misconfiguration: PROXY_URL env var is not set. Start the proxy app and set PROXY_URL.');
        return;
      }
      const proxyScript = `<script>window.PROXY_BASE = '${proxyBase}';</script>`;
      fs.readFile(path.join(__dirname, 'public', 'volunteer.html'), 'utf8', (err, html) => {
        if (err) { res.writeHead(404); res.end('Not found'); return; }
        const injected = html.replace('</head>', proxyScript + '\n</head>');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(injected);
      });
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
    if (req.method === 'GET' && url === '/favicon.ico') {
      res.writeHead(204); res.end(); return;
    }
    if (req.method === 'GET' && url === '/inspect') {
      res.writeHead(301, { Location: '/inspect/' }); res.end(); return;
    }
    if (req.method === 'GET' && url === '/inspect/') {
      // Inject PROXY_BASE so detector/app.js routes through the standalone proxy.
      const proxyBase = process.env.PROXY_URL;
      if (!proxyBase) {
        res.writeHead(500);
        res.end('Server misconfiguration: PROXY_URL env var is not set. Start the proxy app and set PROXY_URL.');
        return;
      }
      fs.readFile(path.join(DETECTOR_DIR, 'index.html'), 'utf8', (err, html) => {
        if (err) { res.writeHead(404); res.end('Not found'); return; }
        const injected = html.replace(
          '</head>',
          `<script>window.PROXY_BASE = '${proxyBase}';</script>\n</head>`,
        );
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(injected);
      });
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
    if (req.method === 'GET' && url.endsWith('/detection-core.js')) {
      serveFile(res, path.join(DETECTOR_DIR, 'detection-core.js'), 'application/javascript; charset=utf-8');
      return;
    }
    if (req.method === 'GET' && url.endsWith('.js')) {
      serveFile(res, path.join(__dirname, 'public', path.basename(url)), 'application/javascript; charset=utf-8');
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
    if (req.method === 'GET' && url === '/api/streams/stats') {
      handleStreamStats(req, res); return;
    }
    if (req.method === 'GET' && url === '/api/streams') {
      handleStreamsList(req, res); return;
    }
    if (req.method === 'POST' && url === '/api/streams') {
      await handleStreamsUpload(req, res); return;
    }
    if (req.method === 'POST' && url === '/api/streams/upsert') {
      await handleStreamsUpsert(req, res); return;
    }
    if (req.method === 'POST' && url === '/api/streams/toggle') {
      await handleStreamToggle(req, res); return;
    }

    res.writeHead(404); res.end();
  } catch (err) {
    console.error('Request error:', err);
    if (!res.headersSent) json(res, 500, { error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Election monitor: http://localhost:${PORT}`));
