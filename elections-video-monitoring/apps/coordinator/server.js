'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const { initUserStore, authenticate, hashPassword, addUser, removeUser, listUsers, validateUserInput, createSessionCookie, buildSetCookie, buildClearCookie } = require('./auth');
const { authMiddleware } = require('./middleware');

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

  CREATE TABLE IF NOT EXISTS users (
    username      TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL CHECK(role IN ('admin', 'volunteer'))
  );

  CREATE TABLE IF NOT EXISTS contacts (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    name  TEXT NOT NULL,
    phone TEXT,
    role  TEXT
  );

  CREATE TABLE IF NOT EXISTS stream_contacts (
    stream_id  INTEGER NOT NULL REFERENCES streams(id) ON DELETE CASCADE,
    contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    PRIMARY KEY (stream_id, contact_id)
  );

  CREATE INDEX IF NOT EXISTS idx_reports_stream_ts  ON reports(stream_id, ts);
  CREATE INDEX IF NOT EXISTS idx_reports_session    ON reports(session_id);
  CREATE INDEX IF NOT EXISTS idx_streams_checked    ON streams(last_checked);
  CREATE INDEX IF NOT EXISTS idx_assignments_sess   ON assignments(session_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_hb        ON sessions(last_heartbeat);
  CREATE INDEX IF NOT EXISTS idx_stream_contacts_stream  ON stream_contacts(stream_id);
  CREATE INDEX IF NOT EXISTS idx_stream_contacts_contact ON stream_contacts(contact_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_name_phone ON contacts(name, phone);
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
  upsertContact:     db.prepare(`
    INSERT INTO contacts (name, phone, role) VALUES (?, ?, ?)
    ON CONFLICT(name, phone) DO UPDATE SET role = excluded.role
    RETURNING id
  `),
  linkStreamContact: db.prepare('INSERT OR IGNORE INTO stream_contacts (stream_id, contact_id) VALUES (?, ?)'),
  unlinkStreamContacts: db.prepare('DELETE FROM stream_contacts WHERE stream_id = ?'),
  streamContacts:    db.prepare(`
    SELECT c.id, c.name, c.phone, c.role
    FROM contacts c
    JOIN stream_contacts sc ON sc.contact_id = c.id
    WHERE sc.stream_id = ?
    ORDER BY c.name
  `),
  streamBySection:   db.prepare('SELECT id, url FROM streams WHERE section = ?'),
  streamById:        db.prepare('SELECT id, url, label, section, assigned_users FROM streams WHERE id = ? AND enabled = 1'),
  assignmentTaken:   db.prepare(`
    SELECT 1 FROM assignments a
    JOIN sessions se ON se.id = a.session_id AND se.last_heartbeat > ?
    WHERE a.stream_id = ? AND a.session_id != ?
  `),
  deleteOneAssignment: db.prepare('DELETE FROM assignments WHERE session_id = ? AND stream_id = ?'),
  availableStreams: db.prepare(`
    SELECT s.id, s.section, s.label
    FROM streams s
    WHERE s.enabled = 1
      AND s.id NOT IN (
        SELECT a.stream_id FROM assignments a
        JOIN sessions se ON se.id = a.session_id AND se.last_heartbeat > ?
      )
    ORDER BY s.section
  `),
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

// Sync contacts for a stream: replace all links, upsert each contact row
function txSyncContacts(streamId, contacts) {
  if (!Array.isArray(contacts)) return;
  stmt.unlinkStreamContacts.run(streamId);
  for (const c of contacts) {
    if (!c || !c.name) continue;
    const row = stmt.upsertContact.get(c.name, c.phone || null, c.role || null);
    stmt.linkStreamContact.run(streamId, row.id);
  }
}

function txBulkUpload(streams) {
  return transaction(() => {
    db.exec('DELETE FROM stream_contacts');
    db.exec('DELETE FROM reports');
    db.exec('DELETE FROM assignments');
    db.exec('DELETE FROM sessions');
    db.exec('DELETE FROM streams');
    for (const s of streams) {
      const section = s.section || extractSection(s.url) || String(s.label);
      stmt.insertStream.run(section, s.url, String(s.label), s.assigned_users || null);
      if (s.contacts) {
        const row = stmt.streamBySection.get(section);
        if (row) txSyncContacts(row.id, s.contacts);
      }
    }
    return streams.length;
  });
}

function txUpsertStreams(streams) {
  return transaction(() => {
    let inserted = 0, updated = 0;
    for (const s of streams) {
      const section = s.section || extractSection(s.url) || String(s.label);
      const existing = stmt.streamBySection.get(section);
      stmt.upsertStream.run(section, s.url, String(s.label), s.assigned_users || null);
      if (existing) { if (existing.url !== s.url) updated++; }
      else inserted++;
      if (s.contacts) {
        const row = existing || stmt.streamBySection.get(section);
        if (row) txSyncContacts(row.id, s.contacts);
      }
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
      if (size > 20 * 1024 * 1024) { req.destroy(); reject(new Error('Body too large')); return; }
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

function enrichWithContacts(streams) {
  return streams.map(s => ({ ...s, contacts: stmt.streamContacts.all(s.id) }));
}

async function handleSession(req, res) {
  let body = {};
  try { body = await readBody(req); } catch {}

  // Resume existing session if the client sends a known session_id
  if (body.session_id && stmt.sessionExists.get(body.session_id)) {
    stmt.heartbeat.run(Date.now(), body.session_id);
    const userId = body.user_id || null;

    // Ensure pre-assigned streams are in the session, but keep manually-added ones too
    if (userId) {
      const preAssigned = db.prepare(`
        SELECT s.id, s.url, s.label, s.section, s.assigned_users FROM streams s
        WHERE s.enabled = 1
          AND s.assigned_users IS NOT NULL
          AND (',' || s.assigned_users || ',') LIKE ('%,' || ? || ',%')
        ORDER BY s.section ASC
      `).all(userId);
      const now = Date.now();
      for (const s of preAssigned) {
        stmt.insertAssignment.run(body.session_id, s.id, now); // INSERT OR REPLACE — safe if already exists
      }
    }

    // Return all streams currently assigned to this session
    let streams = db.prepare(`
      SELECT s.id, s.url, s.label, s.section, s.assigned_users FROM streams s
      JOIN assignments a ON a.stream_id = s.id
      WHERE a.session_id = ?
    `).all(body.session_id);

    json(res, 200, { session_id: body.session_id, streams: enrichWithContacts(streams), resumed: true });
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
  json(res, 200, { session_id: sessionId, streams: enrichWithContacts(streams) });
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
  const streams = stmt.allStreams.all().map(s => ({
    ...s,
    contacts: stmt.streamContacts.all(s.id),
  }));
  json(res, 200, { streams });
}

function handleAvailableStreams(req, res) {
  const cutoff = Date.now() - 120_000;
  const rows = stmt.availableStreams.all(cutoff);
  json(res, 200, { streams: rows });
}

async function handleAddStreams(req, res) {
  const body = await readBody(req);
  const { session_id, stream_ids } = body;
  if (!session_id || !Array.isArray(stream_ids) || stream_ids.length === 0) {
    json(res, 400, { error: 'session_id and stream_ids[] required' }); return;
  }
  if (!stmt.sessionExists.get(session_id)) {
    json(res, 404, { error: 'session not found' }); return;
  }
  const now = Date.now();
  const cutoff = now - 120_000;
  const added = [];
  transaction(() => {
    for (const sid of stream_ids) {
      const stream = stmt.streamById.get(sid);
      if (!stream) continue;
      // Skip if already assigned to another active session
      const taken = stmt.assignmentTaken.get(cutoff, stream.id, session_id);
      if (taken) continue;
      stmt.insertAssignment.run(session_id, stream.id, now);
      added.push(enrichWithContacts([stream])[0]);
    }
  });
  json(res, 200, { added });
}

async function handleRemoveStream(req, res) {
  const body = await readBody(req);
  const { session_id, stream_id } = body;
  if (!session_id || typeof stream_id !== 'number') {
    json(res, 400, { error: 'session_id and stream_id required' }); return;
  }
  if (!stmt.sessionExists.get(session_id)) {
    json(res, 404, { error: 'session not found' }); return;
  }
  stmt.deleteOneAssignment.run(session_id, stream_id);
  json(res, 200, { ok: true });
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

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    });
    res.end();
    return;
  }

  try {
    // Auth middleware — redirects or rejects unauthorized requests
    if (authMiddleware(req, res)) return;
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
    if (req.method === 'GET' && url === '/help') {
      serveFile(res, path.join(__dirname, 'public', 'help.html'), 'text/html; charset=utf-8');
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

    // Auth routes
    if (req.method === 'GET' && url === '/login') {
      serveFile(res, path.join(__dirname, 'public', 'login.html'), 'text/html; charset=utf-8');
      return;
    }
    if (req.method === 'POST' && url === '/api/login') {
      let body;
      try {
        body = await readBody(req);
      } catch (e) {
        json(res, 400, { error: 'Invalid request body' });
        return;
      }
      const { username, password } = body;
      if (!username || !password) {
        json(res, 400, { error: 'Username and password required' });
        return;
      }
      const result = authenticate(db, username, password);
      if (!result) {
        json(res, 401, { error: 'Invalid credentials' });
        return;
      }
      const cookie = createSessionCookie(username, result.role);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Set-Cookie': buildSetCookie(cookie),
      });
      res.end(JSON.stringify({ role: result.role }));
      return;
    }
    if (req.method === 'POST' && url === '/api/logout') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Set-Cookie': buildClearCookie(),
      });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // User management
    if (req.method === 'POST' && url === '/api/users/bulk') {
      let body;
      try {
        body = await readBody(req);
      } catch (e) {
        json(res, 400, { error: 'Invalid request body' });
        return;
      }
      if (!Array.isArray(body)) {
        json(res, 400, { error: 'Expected JSON array' });
        return;
      }
      let created = 0;
      const skipped = [];
      const insertStmt = db.prepare('INSERT OR IGNORE INTO users (username, password_hash, role) VALUES (?, ?, ?)');
      db.exec('BEGIN');
      try {
        for (const entry of body) {
          const invalid = validateUserInput(entry.username, entry.password, entry.role);
          if (invalid) {
            skipped.push(entry.username != null ? String(entry.username) : '(invalid)');
            continue;
          }
          const hash = hashPassword(entry.password);
          const result = insertStmt.run(entry.username, hash, entry.role);
          if (result.changes > 0) {
            created++;
          } else {
            skipped.push(entry.username);
          }
        }
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
      if (skipped.length > 0) {
        json(res, 200, { ok: true, created, skipped });
      } else {
        json(res, 201, { ok: true, created });
      }
      return;
    }

    if (req.method === 'POST' && url === '/api/users') {
      let body;
      try {
        body = await readBody(req);
      } catch (e) {
        json(res, 400, { error: 'Invalid request body' });
        return;
      }
      const { username, password, role } = body;
      const invalid = validateUserInput(username, password, role);
      if (invalid) {
        json(res, 400, invalid);
        return;
      }
      const hash = hashPassword(password);
      try {
        addUser(db, username, hash, role);
      } catch (e) {
        if (e.message && e.message.includes('UNIQUE')) {
          json(res, 409, { error: 'Username already exists' });
          return;
        }
        throw e;
      }
      json(res, 201, { ok: true, username, role });
      return;
    }

    if (req.method === 'DELETE' && url.startsWith('/api/users/')) {
      const targetUsername = decodeURIComponent(url.split('/')[3]);
      if (targetUsername === req.user.username) {
        json(res, 400, { error: 'Cannot delete own account' });
        return;
      }
      const deleted = removeUser(db, targetUsername);
      if (!deleted) {
        json(res, 404, { error: 'User not found' });
        return;
      }
      json(res, 200, { ok: true });
      return;
    }

    if (req.method === 'GET' && url === '/api/users') {
      const users = listUsers(db);
      json(res, 200, users);
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
    if (req.method === 'GET' && url === '/api/streams/available') {
      handleAvailableStreams(req, res); return;
    }
    if (req.method === 'POST' && url === '/api/session/streams') {
      await handleAddStreams(req, res); return;
    }
    if (req.method === 'DELETE' && url === '/api/session/streams') {
      await handleRemoveStream(req, res); return;
    }

    res.writeHead(404); res.end();
  } catch (err) {
    console.error('Request error:', err);
    if (!res.headersSent) json(res, 500, { error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
initUserStore(db);
server.listen(PORT, () => console.log(`Election monitor: http://localhost:${PORT}`));
