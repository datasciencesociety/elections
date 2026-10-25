'use strict';

// Backup cover (AUTOFILL_AFTER): heartbeats top a session up to 4 cards with assigned sections
// nobody watches, and never take a card away. Boots the real server.js on a temp DB.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

let base, child, adminCookie;

async function request(method, urlPath, { body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(base + urlPath, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual',
  });
  const raw = await res.text();
  let parsed;
  try { parsed = JSON.parse(raw); } catch { parsed = raw; }
  return { status: res.status, headers: res.headers, body: parsed };
}

async function login(username, password = 'volpass123') {
  const res = await request('POST', '/api/login', { body: { username, password } });
  assert.equal(res.status, 200, `login ${username}`);
  return res.headers.get('set-cookie').split(';')[0];
}

async function newSession(cookie) {
  const res = await request('POST', '/api/session', { cookie, body: {} });
  assert.equal(res.status, 200);
  return res.body;
}

const heartbeat = (cookie, session_id) => request('POST', '/api/heartbeat', { cookie, body: { session_id } });
const resume = (cookie, session_id) => request('POST', '/api/session', { cookie, body: { session_id } });

before(async () => {
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coord-autofill-'));
  child = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    env: {
      ...process.env,
      PORT: String(port),
      DB_PATH: path.join(tmpDir, 'test.db'),
      ADMIN_USER: 'testadmin',
      ADMIN_PASS: 'testadminpass',
      COOKIE_SECRET: 'test-secret',
      PROXY_URL: 'http://127.0.0.1:1',
      AUTOFILL_AFTER: '2000-01-01T00:00:00Z',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start')), 10_000);
    child.stdout.on('data', (d) => {
      if (d.toString().includes('Election monitor')) { clearTimeout(timer); resolve(); }
    });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited ${code}`)); });
  });

  adminCookie = await login('testadmin', 'testadminpass');
  for (const u of ['owner1', 'owner2', 'owner3', 'owner4', 'owner5', 'owner6', 'spare1', 'spare2']) {
    const res = await request('POST', '/api/users', {
      cookie: adminCookie, body: { username: u, password: 'volpass123', role: 'volunteer' },
    });
    assert.equal(res.status, 201);
  }
  const seed = await request('POST', '/api/streams/upsert', {
    cookie: adminCookie,
    body: [
      { section: '020000001', url: 'https://example.test/1.mp4', label: 'S1', assigned_users: 'owner1' },
      { section: '020000002', url: 'https://example.test/2.mp4', label: 'S2', assigned_users: 'owner2' },
      { section: '020000003', url: 'https://example.test/3.mp4', label: 'S3', assigned_users: 'owner3' },
      { section: '020000004', url: 'https://example.test/4.mp4', label: 'S4', assigned_users: 'owner4' },
      { section: '020000005', url: 'https://example.test/5.mp4', label: 'S5', assigned_users: 'owner5' },
      { section: '020000006', url: '', label: 'S6 stub', assigned_users: 'owner6' },
      { section: '020000007', url: 'https://example.test/7.mp4', label: 'S7 nobody' },
    ],
  });
  assert.equal(seed.status, 200);
});

after(() => { if (child) child.kill(); });

describe('Backup cover for sections whose volunteer is away', () => {
  let owner1Cookie, spare1Cookie, spare1, ids;

  before(async () => {
    owner1Cookie = await login('owner1');
    spare1Cookie = await login('spare1');
    const all = (await request('GET', '/api/streams', { cookie: adminCookie })).body.streams;
    ids = Object.fromEntries(all.map((s) => [s.label, s.id]));
    // owner1 is online and covers S1
    const own = await newSession(owner1Cookie);
    assert.equal(own.streams[0].label, 'S1');
  });

  it('tops a volunteer up to 4 cards with assigned sections nobody watches, video first', async () => {
    spare1 = await newSession(spare1Cookie);           // 2 random cards
    const hb = await heartbeat(spare1Cookie, spare1.session_id);
    assert.equal(hb.body.ok, true);
    const added = hb.body.assigned_streams.map((s) => s.label);
    const cards = new Set([...spare1.streams.map((s) => s.label), ...added]);
    assert.equal(cards.size, 4);
    for (const label of added) {
      assert.notEqual(label, 'S1', 'S1 is covered by owner1');
      assert.notEqual(label, 'S7 nobody', 'only assigned sections are backed up');
      assert.notEqual(label, 'S6 stub', 'sections with video come before stubs');
    }
    const resumed = await resume(spare1Cookie, spare1.session_id);
    assert.equal(resumed.body.streams.length, 4);
  });

  it('a full session gets nothing more and loses nothing', async () => {
    const before = (await resume(spare1Cookie, spare1.session_id)).body.streams.map((s) => s.id).sort();
    const hb = await heartbeat(spare1Cookie, spare1.session_id);
    assert.deepEqual(hb.body.assigned_streams, []);
    const after = (await resume(spare1Cookie, spare1.session_id)).body.streams.map((s) => s.id).sort();
    assert.deepEqual(after, before);
  });

  it('a backup card stays when its own volunteer comes back', async () => {
    const cards = (await resume(spare1Cookie, spare1.session_id)).body.streams;
    const backup = cards.find((s) => s.assigned_users && s.assigned_users !== 'owner1');
    const ownerCookie = await login(backup.assigned_users);
    const own = await newSession(ownerCookie);
    assert.ok(own.streams.some((s) => s.id === backup.id), 'owner gets the section too');
    await heartbeat(spare1Cookie, spare1.session_id);
    const after = (await resume(spare1Cookie, spare1.session_id)).body.streams.map((s) => s.id);
    assert.ok(after.includes(backup.id), 'backup volunteer keeps it');
  });

  it('a card the volunteer closed is replaced by another, never by the same one', async () => {
    const cards = (await resume(spare1Cookie, spare1.session_id)).body.streams;
    const closed = cards[0].id;
    const rm = await request('DELETE', '/api/session/streams', {
      cookie: spare1Cookie, body: { session_id: spare1.session_id, stream_id: closed },
    });
    assert.equal(rm.status, 200);
    await heartbeat(spare1Cookie, spare1.session_id);
    const after = (await resume(spare1Cookie, spare1.session_id)).body.streams.map((s) => s.id);
    assert.ok(!after.includes(closed));
    assert.ok(after.length <= 4);
  });

  it('a covered section is not handed to a second volunteer', async () => {
    const spare2Cookie = await login('spare2');
    const s2 = await newSession(spare2Cookie);
    const hb = await heartbeat(spare2Cookie, s2.session_id);
    const covered = new Set((await resume(spare1Cookie, spare1.session_id)).body.streams.map((s) => s.id));
    covered.add(ids.S1);
    for (const s of hb.body.assigned_streams) assert.ok(!covered.has(s.id), `${s.label} was already covered`);
  });
});
