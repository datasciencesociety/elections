'use strict';
// Audit log: one JSON line per login, admin action and volunteer action. Never logs passwords
// or cookies. Files go to a directory next to the DB (data/audit/, ignored by git as *.log),
// one per UTC hour: audit-2026-10-25T20.log. When the files pass maxBytes in total the oldest
// are deleted, so the log cannot fill the disk. Writes are buffered by a stream, so a slow
// disk never blocks a request; a write error is reported once on stderr and the app keeps serving.
const fs = require('fs');
const path = require('path');

const FILE_RE = /^audit-\d{4}-\d{2}-\d{2}T\d{2}\.log$/;

function clientIp(req) {
  return req.headers['x-real-ip'] || req.socket.remoteAddress || '';
}

function hourFile(date) {
  return `audit-${date.toISOString().slice(0, 13)}.log`;
}

// Deletes the oldest hourly files until the rest fit in maxBytes. `keep` is never deleted.
function pruneAuditDir(dir, maxBytes, keep) {
  const files = fs.readdirSync(dir).filter((f) => FILE_RE.test(f)).sort()
    .map((f) => ({ f, size: fs.statSync(path.join(dir, f)).size }));
  let total = files.reduce((n, x) => n + x.size, 0);
  const deleted = [];
  for (const { f, size } of files) {
    if (total <= maxBytes) break;
    if (f === keep) continue;
    fs.unlinkSync(path.join(dir, f));
    total -= size;
    deleted.push(f);
  }
  return deleted;
}

function createAudit(dir, { maxBytes = 500 * 1024 * 1024, now = () => new Date() } = {}) {
  let out = null;
  let current = null;
  let failed = false;

  function disable(e) {
    if (!failed) console.error(`audit log disabled: ${e.message}`);
    failed = true;
  }

  function openFor(date) {
    const name = hourFile(date);
    if (name === current && out) return;
    if (out) out.end();
    current = name;
    out = fs.createWriteStream(path.join(dir, name), { flags: 'a', mode: 0o640 });
    out.on('error', disable);
    try {
      const deleted = pruneAuditDir(dir, maxBytes, name);
      if (deleted.length) console.log(`audit log: deleted ${deleted.length} old file(s) over the size limit`);
    } catch (e) {
      console.error(`audit log cleanup failed: ${e.message}`);
    }
  }

  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o750 });
    openFor(now());
  } catch (e) {
    disable(e);
  }

  // Last status reported per session and stream: reports are logged only when the status changes.
  // A few thousand entries on election night (sessions x cards), so it is never pruned.
  const lastStatus = new Map();

  function audit(req, action, details = {}) {
    if (failed) return;
    const date = now();
    try { openFor(date); } catch (e) { disable(e); return; }
    const line = {
      ts: date.toISOString(),
      action,
      user: req.user ? req.user.username : undefined,
      role: req.user ? req.user.role : undefined,
      ip: clientIp(req),
      ...details,
    };
    out.write(JSON.stringify(line) + '\n');
  }

  function auditReports(req, sessionId, results) {
    for (const r of results) {
      const key = `${sessionId}|${r.stream_id}`;
      if (lastStatus.get(key) === r.status) continue;
      const from = lastStatus.get(key);
      lastStatus.set(key, r.status);
      audit(req, 'report.status', { session: sessionId.slice(0, 8), stream_id: r.stream_id, from, to: r.status });
    }
  }

  return { audit, auditReports };
}

module.exports = { createAudit, pruneAuditDir, hourFile, clientIp };
