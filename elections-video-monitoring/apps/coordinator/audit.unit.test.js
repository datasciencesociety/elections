'use strict';

// Hourly audit files and the size cap that keeps them from filling the disk.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createAudit, pruneAuditDir, hourFile } = require('./audit');

const req = { headers: {}, socket: { remoteAddress: '127.0.0.1' }, user: { username: 'u1', role: 'volunteer' } };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'audit-test-'));
const write = (dir, name, bytes) => fs.writeFileSync(path.join(dir, name), 'x'.repeat(bytes));
const settle = () => new Promise((r) => setTimeout(r, 50));

describe('audit log files', () => {
  it('names files by UTC hour', () => {
    assert.equal(hourFile(new Date('2026-10-25T20:59:59Z')), 'audit-2026-10-25T20.log');
  });

  it('starts a new file when the hour changes', async () => {
    const dir = tmp();
    let t = new Date('2026-10-25T19:59:00Z');
    const { audit } = createAudit(dir, { now: () => t });
    audit(req, 'a');
    t = new Date('2026-10-25T20:00:01Z');
    audit(req, 'b');
    await settle();
    assert.deepEqual(fs.readdirSync(dir).sort(), ['audit-2026-10-25T19.log', 'audit-2026-10-25T20.log']);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'audit-2026-10-25T20.log'), 'utf8')).action, 'b');
  });

  it('deletes the oldest files above the cap, never the current one or other files', () => {
    const dir = tmp();
    write(dir, 'audit-2026-10-25T17.log', 400);
    write(dir, 'audit-2026-10-25T18.log', 400);
    write(dir, 'audit-2026-10-25T19.log', 400);
    write(dir, 'notes.txt', 5000);
    assert.deepEqual(pruneAuditDir(dir, 1000, 'audit-2026-10-25T19.log'), ['audit-2026-10-25T17.log']);
    assert.deepEqual(fs.readdirSync(dir).sort(), ['audit-2026-10-25T18.log', 'audit-2026-10-25T19.log', 'notes.txt']);
    // The current file alone over the cap stays
    assert.deepEqual(pruneAuditDir(dir, 100, 'audit-2026-10-25T19.log'), ['audit-2026-10-25T18.log']);
    assert.ok(fs.existsSync(path.join(dir, 'audit-2026-10-25T19.log')));
  });

  it('prunes when a new hour starts', async () => {
    const dir = tmp();
    write(dir, 'audit-2026-10-25T10.log', 2000);
    let t = new Date('2026-10-25T19:00:00Z');
    const { audit } = createAudit(dir, { maxBytes: 1000, now: () => t });
    await settle();
    assert.ok(!fs.existsSync(path.join(dir, 'audit-2026-10-25T10.log')));
    audit(req, 'a');
    await settle();
    assert.ok(fs.existsSync(path.join(dir, 'audit-2026-10-25T19.log')));
  });

  it('keeps serving when the directory cannot be created', () => {
    const file = path.join(tmp(), 'not-a-dir');
    fs.writeFileSync(file, '');
    const err = console.error; console.error = () => {};
    try {
      const { audit } = createAudit(path.join(file, 'audit'));
      assert.doesNotThrow(() => audit(req, 'a'));
    } finally { console.error = err; }
  });
});
