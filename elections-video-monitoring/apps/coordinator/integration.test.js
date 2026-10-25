'use strict';

// Boots the real server.js on a temp DB and exercises auth + session rules over HTTP.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

// ── Helpers ──────────────────────────────────────────────────────────────────

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

let base;

async function request(method, urlPath, { body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(base + urlPath, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  });
  const raw = await res.text();
  let parsed;
  try { parsed = JSON.parse(raw); } catch { parsed = raw; }
  return { status: res.status, headers: res.headers, body: parsed };
}

async function login(username, password) {
  const res = await request('POST', '/api/login', { body: { username, password } });
  assert.equal(res.status, 200, `login ${username}`);
  return res.headers.get('set-cookie').split(';')[0];
}

// ── Server lifecycle ─────────────────────────────────────────────────────────

let child;
let adminCookie, vol1Cookie, vol2Cookie;

before(async () => {
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coord-test-'));

  child = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    env: {
      ...process.env,
      PORT: String(port),
      DB_PATH: path.join(tmpDir, 'test.db'),
      ADMIN_USER: 'testadmin',
      ADMIN_PASS: 'testadminpass',
      COOKIE_SECRET: 'test-secret',
      PROXY_URL: 'http://127.0.0.1:1',
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
  for (const u of ['vol1', 'vol2', 'vol3']) {
    const res = await request('POST', '/api/users', {
      cookie: adminCookie, body: { username: u, password: 'volpass123', role: 'volunteer' },
    });
    assert.equal(res.status, 201);
  }
  vol1Cookie = await login('vol1', 'volpass123');
  vol2Cookie = await login('vol2', 'volpass123');

  const seed = await request('POST', '/api/streams/upsert', {
    cookie: adminCookie,
    body: [
      { section: '010100001', url: 'https://example.test/a.mp4', label: 'A', assigned_users: 'vol1' },
      { section: '010100002', url: 'https://example.test/b.mp4', label: 'B', assigned_users: 'vol2' },
      { section: '010100003', url: 'https://example.test/c.mp4', label: 'C' },
    ],
  });
  assert.equal(seed.status, 200);
});

after(() => {
  if (child) child.kill();
});

// ── Route access ─────────────────────────────────────────────────────────────

describe('Default-deny route access', () => {
  const protectedApi = [
    ['POST', '/api/streams/upsert'],
    ['POST', '/api/streams/toggle'],
    ['POST', '/api/streams'],
    ['POST', '/api/session'],
    ['POST', '/api/session/streams'],
    ['DELETE', '/api/session/streams'],
    ['POST', '/api/heartbeat'],
    ['POST', '/api/report'],
    ['GET', '/api/flagged'],
    ['GET', '/api/users'],
    ['GET', '/api/streams'],
    ['GET', '/api/streams/available'],
    ['GET', '/api/not-a-route'],
  ];

  for (const [method, p] of protectedApi) {
    it(`unauthenticated ${method} ${p} → 401`, async () => {
      const res = await request(method, p, { body: method === 'GET' ? undefined : {} });
      assert.equal(res.status, 401);
    });
  }

  for (const p of ['/', '/admin', '/inspect/', '/help', '/poc', '/proxy/anything', '/not-a-page']) {
    it(`unauthenticated GET ${p} → redirect to /login`, async () => {
      const res = await request('GET', p);
      assert.equal(res.status, 302);
      assert.equal(res.headers.get('location'), '/login');
    });
  }

  for (const p of ['/api/streams/count', '/api/streams/stats', '/login']) {
    it(`public GET ${p} → 200`, async () => {
      const res = await request('GET', p);
      assert.equal(res.status, 200);
    });
  }

  for (const [method, p] of [['POST', '/api/streams/upsert'], ['POST', '/api/streams/toggle'], ['POST', '/api/streams']]) {
    it(`volunteer ${method} ${p} → 401`, async () => {
      const res = await request(method, p, { cookie: vol1Cookie, body: [] });
      assert.equal(res.status, 401);
    });
  }
});

// ── Cookies ──────────────────────────────────────────────────────────────────

describe('Login cookies', () => {
  it('malformed cookie is treated as logged out, not a 500', async () => {
    const page = await request('GET', '/admin', { cookie: 'session=abc.def' });
    assert.equal(page.status, 302);
    const api = await request('GET', '/api/users', { cookie: 'session=abc.def' });
    assert.equal(api.status, 401);
  });

  it('login cookie carries Max-Age', async () => {
    const res = await request('POST', '/api/login', { body: { username: 'vol1', password: 'volpass123' } });
    assert.match(res.headers.get('set-cookie'), /Max-Age=\d+/);
  });

  it('deleted user loses access immediately', async () => {
    const vol3Cookie = await login('vol3', 'volpass123');
    assert.equal((await request('GET', '/api/flagged', { cookie: vol3Cookie })).status, 200);
    const del = await request('DELETE', '/api/users/vol3', { cookie: adminCookie });
    assert.equal(del.status, 200);
    assert.equal((await request('GET', '/api/flagged', { cookie: vol3Cookie })).status, 401);
  });
});

// ── Sessions ─────────────────────────────────────────────────────────────────

describe('Volunteer sessions', () => {
  let vol1Session, vol1Streams, streamC;

  before(async () => {
    // vol1 claims to be vol2 in the body — must be ignored
    const res = await request('POST', '/api/session', { cookie: vol1Cookie, body: { user_id: 'vol2' } });
    assert.equal(res.status, 200);
    vol1Session = res.body.session_id;
    vol1Streams = res.body.streams;
    const all = await request('GET', '/api/streams', { cookie: vol1Cookie });
    streamC = all.body.streams.find((s) => s.section === '010100003');
  });

  it('assignments come from the login, not body.user_id', () => {
    assert.deepEqual(vol1Streams.map((s) => s.section), ['010100001']);
  });

  it('another user cannot heartbeat, report on, or edit the session', async () => {
    const hb = await request('POST', '/api/heartbeat', { cookie: vol2Cookie, body: { session_id: vol1Session } });
    assert.equal(hb.body.reinit, true);
    const rep = await request('POST', '/api/report', {
      cookie: vol2Cookie, body: { session_id: vol1Session, results: [{ stream_id: vol1Streams[0].id, status: 'frozen' }] },
    });
    assert.equal(rep.status, 400);
    const add = await request('POST', '/api/session/streams', {
      cookie: vol2Cookie, body: { session_id: vol1Session, stream_ids: [streamC.id] },
    });
    assert.equal(add.status, 404);
    const rm = await request('DELETE', '/api/session/streams', {
      cookie: vol2Cookie, body: { session_id: vol1Session, stream_id: vol1Streams[0].id },
    });
    assert.equal(rm.status, 404);
  });

  it('owner can heartbeat its own session', async () => {
    const hb = await request('POST', '/api/heartbeat', { cookie: vol1Cookie, body: { session_id: vol1Session } });
    assert.equal(hb.body.ok, true);
  });

  it('upsert without assigned_users keeps existing assignments; empty string clears them', async () => {
    const before = (await request('GET', '/api/streams', { cookie: adminCookie })).body.streams.find((s) => s.section === '010100001');
    assert.equal(before.assigned_users, 'vol1');
    // scraper-style batch: new URL, no assigned_users field
    await request('POST', '/api/streams/upsert', {
      cookie: adminCookie, body: [{ section: '010100001', url: before.url, label: 'A (rescraped)' }],
    });
    const kept = (await request('GET', '/api/streams', { cookie: adminCookie })).body.streams.find((s) => s.section === '010100001');
    assert.equal(kept.assigned_users, 'vol1');
    assert.equal(kept.label, 'A (rescraped)');
    await request('POST', '/api/streams/upsert', {
      cookie: adminCookie, body: [{ section: '010100003', url: 'https://example.test/c.mp4', label: 'C', assigned_users: '' }],
    });
    const cleared = (await request('GET', '/api/streams', { cookie: adminCookie })).body.streams.find((s) => s.section === '010100003');
    assert.ok(!cleared.assigned_users);
  });

  it('a single report flags a stream; reports on unassigned streams are ignored', async () => {
    const rep = await request('POST', '/api/report', {
      cookie: vol1Cookie,
      body: {
        session_id: vol1Session,
        results: [
          { stream_id: vol1Streams[0].id, status: 'frozen' },
          { stream_id: streamC.id, status: 'covered' },
        ],
      },
    });
    assert.equal(rep.status, 200);
    const flagged = await request('GET', '/api/flagged', { cookie: adminCookie });
    const ids = flagged.body.flagged.map((f) => f.stream_id);
    assert.deepEqual(ids, [vol1Streams[0].id]);
  });
});

// ── Stubs: sections whose stream is not published yet ───────────────────────

describe('Stub streams (no URL yet)', () => {
  const STUB = '010100009';
  let vol4Cookie, session, stubId;

  before(async () => {
    const created = await request('POST', '/api/users', {
      cookie: adminCookie, body: { username: 'vol4', password: 'volpass123', role: 'volunteer' },
    });
    assert.equal(created.status, 201);
    vol4Cookie = await login('vol4', 'volpass123');
    const up = await request('POST', '/api/streams/upsert', {
      cookie: adminCookie, body: [{ section: STUB, url: '', label: 'Stub', assigned_users: 'vol4' }],
    });
    assert.equal(up.status, 200);
    assert.equal(up.body.inserted, 1);
    const res = await request('POST', '/api/session', { cookie: vol4Cookie, body: {} });
    session = res.body.session_id;
    stubId = res.body.streams.find((s) => s.section === STUB).id;
  });

  it('a URL must be http(s) or empty', async () => {
    const res = await request('POST', '/api/streams/upsert', {
      cookie: adminCookie, body: [{ section: '010100011', url: 'javascript:alert(1)', label: 'Bad' }, { section: '010100012', url: 'not a url', label: 'Bad 2' }],
    });
    assert.equal(res.status, 400);
  });

  it('a stub needs a section', async () => {
    const res = await request('POST', '/api/streams/upsert', { cookie: adminCookie, body: [{ url: '', label: 'No section' }] });
    assert.equal(res.status, 400);
  });

  it('the volunteer session gets the stub with an empty URL', async () => {
    const res = await request('POST', '/api/session', { cookie: vol4Cookie, body: { session_id: session } });
    assert.equal(res.body.streams.find((s) => s.id === stubId).url, '');
  });

  it('a waiting report does not flag', async () => {
    const rep = await request('POST', '/api/report', {
      cookie: vol4Cookie, body: { session_id: session, results: [{ stream_id: stubId, status: 'waiting' }] },
    });
    assert.equal(rep.status, 200);
    const flagged = await request('GET', '/api/flagged', { cookie: adminCookie });
    assert.ok(!flagged.body.flagged.some((f) => f.stream_id === stubId));
  });

  it('heartbeat returns the URL once the scrape fills the stub', async () => {
    await request('POST', '/api/streams/upsert', {
      cookie: adminCookie, body: [{ section: STUB, url: 'https://example.test/live/index.m3u8', label: 'Stub' }],
    });
    const hb = await request('POST', '/api/heartbeat', { cookie: vol4Cookie, body: { session_id: session } });
    assert.equal(hb.body.urls[stubId], 'https://example.test/live/index.m3u8');
  });

  it('re-uploading a stub does not blank a known URL', async () => {
    await request('POST', '/api/streams/upsert', {
      cookie: adminCookie, body: [{ section: STUB, url: '', label: 'Stub again' }],
    });
    const s = (await request('GET', '/api/streams', { cookie: adminCookie })).body.streams.find((x) => x.section === STUB);
    assert.equal(s.url, 'https://example.test/live/index.m3u8');
    assert.equal(s.label, 'Stub again');
  });

  // Last: replacing wipes every stream and session
  it('replace accepts stubs', async () => {
    const res = await request('POST', '/api/streams', {
      cookie: adminCookie, body: [{ section: STUB, url: '', label: 'Stub' }, { section: '010100010', url: '', label: 'Stub 2' }],
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.inserted, 2);
  });
});
