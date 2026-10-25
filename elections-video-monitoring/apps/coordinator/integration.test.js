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
let tmpDir;

before(async () => {
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coord-test-'));

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
    ['POST', '/api/streams/risk'],
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

  for (const [method, p] of [['POST', '/api/streams/upsert'], ['POST', '/api/streams/toggle'], ['POST', '/api/streams/risk'], ['POST', '/api/streams']]) {
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
  let vol1Session, vol1Streams, streamB, streamC;

  before(async () => {
    // vol1 claims to be vol2 in the body — must be ignored
    const res = await request('POST', '/api/session', { cookie: vol1Cookie, body: { user_id: 'vol2' } });
    assert.equal(res.status, 200);
    vol1Session = res.body.session_id;
    vol1Streams = res.body.streams;
    const all = await request('GET', '/api/streams', { cookie: vol1Cookie });
    streamB = all.body.streams.find((s) => s.section === '010100002');
    streamC = all.body.streams.find((s) => s.section === '010100003');
  });

  it('assignments come from the login, not body.user_id', () => {
    // Own section first; vol2's never, whatever body.user_id says (unassigned ones may fill the rest)
    assert.equal(vol1Streams[0].section, '010100001');
    assert.ok(!vol1Streams.some((s) => s.section === '010100002'));
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
          { stream_id: streamB.id, status: 'covered' },
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

  it('a whitespace-only URL is a stub, and does not blank a known URL', async () => {
    await request('POST', '/api/streams/upsert', { cookie: adminCookie, body: [{ section: STUB, url: '   ', label: 'Stub' }] });
    const s = (await request('GET', '/api/streams', { cookie: adminCookie })).body.streams.find((x) => x.section === STUB);
    assert.equal(s.url, 'https://example.test/live/index.m3u8');
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

// ── Audit log ────────────────────────────────────────────────────────────────

describe('Audit log', () => {
  // All hourly files, oldest first
  function auditRaw() {
    const dir = path.join(tmpDir, 'audit');
    if (!fs.existsSync(dir)) return '';
    return fs.readdirSync(dir).filter((f) => /^audit-.*\.log$/.test(f)).sort()
      .map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('');
  }

  // Lines are written through a stream: wait until the expected one is on disk
  async function auditLines(until) {
    for (let i = 0; i < 40; i++) {
      const lines = auditRaw().trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
      if (lines.some(until)) return lines;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.fail('expected audit line never appeared');
  }

  it('records logins, admin changes and volunteer actions next to the DB, without passwords', async () => {
    assert.equal((await request('POST', '/api/login', { body: { username: 'vol1', password: 'wrong-pass-1' } })).status, 401);
    // A section with a link: reports on stubs are always stored as waiting
    await request('POST', '/api/streams/upsert', {
      cookie: adminCookie, body: [{ section: '010100020', url: 'https://example.test/audit.mp4', label: 'Audit', assigned_users: 'vol2' }],
    });
    const s = await request('POST', '/api/session', { cookie: vol2Cookie, body: {} });
    const sid = s.body.session_id;
    const streamId = s.body.streams[0].id;
    for (let i = 0; i < 2; i++) {
      await request('POST', '/api/report', { cookie: vol2Cookie, body: { session_id: sid, results: [{ stream_id: streamId, status: 'covered' }] } });
    }
    await request('POST', '/api/report', { cookie: vol2Cookie, body: { session_id: sid, results: [{ stream_id: streamId, status: 'ok' }] } });

    const lines = await auditLines((l) => l.action === 'report.status' && l.to === 'ok' && l.user === 'vol2');
    const has = (pred, what) => assert.ok(lines.some(pred), what);
    has((l) => l.action === 'login.ok' && l.as === 'testadmin' && l.as_role === 'admin', 'admin login');
    has((l) => l.action === 'login.fail' && l.as === 'vol1' && l.ip, 'failed login with ip');
    has((l) => l.action === 'users.create' && l.user === 'testadmin' && l.target === 'vol1' && l.target_role === 'volunteer', 'user created by admin');
    has((l) => l.action === 'streams.upsert' && l.user === 'testadmin' && l.rows === 3, 'upsert with row count');
    has((l) => l.action === 'session.new' && l.user === 'vol1' && l.mode === 'assigned', 'pre-assigned session');
    has((l) => l.action === 'session.new' && l.user === 'vol2' && ['assigned', 'priority', 'random'].includes(l.mode), 'session with its mode');

    // A status is logged when it changes, not on every report
    const vol2Reports = lines.filter((l) => l.action === 'report.status' && l.user === 'vol2');
    assert.deepEqual(vol2Reports.map((l) => [l.from, l.to]), [[undefined, 'covered'], ['covered', 'ok']]);
    // Reports on streams outside the session are dropped by the server and not logged
    assert.ok(!lines.some((l) => l.action === 'report.status' && l.user === 'vol1' && l.to === 'covered'));

    const raw = auditRaw();
    for (const secret of ['testadminpass', 'volpass123', 'wrong-pass-1', 'test-secret']) {
      assert.ok(!raw.includes(secret), `audit log must not contain ${secret}`);
    }
  });
});

// ── "Добави секция": risk order, up to two watchers ─────────────────────────

describe('Section picker: risk order and two watchers', () => {
  const cookies = {};
  const sessions = {};
  const ids = {};

  before(async () => {
    for (const u of ['risk1', 'risk2', 'risk3']) {
      const res = await request('POST', '/api/users', {
        cookie: adminCookie, body: { username: u, password: 'volpass123', role: 'volunteer' },
      });
      assert.equal(res.status, 201);
      cookies[u] = await login(u, 'volpass123');
    }
    await request('POST', '/api/streams/upsert', {
      cookie: adminCookie,
      body: [
        { section: '030000001', url: 'https://example.test/r1.mp4', label: 'R low' },
        { section: '030000002', url: 'https://example.test/r2.mp4', label: 'R high' },
        { section: '030000003', url: 'https://example.test/r3.mp4', label: 'R none' },
      ],
    });
    const all = (await request('GET', '/api/streams', { cookie: adminCookie })).body.streams;
    for (const s of all) ids[s.label] = s.id;
  });

  it('admin loads risk by section; bad rows are dropped', async () => {
    const res = await request('POST', '/api/streams/risk', {
      cookie: adminCookie,
      body: [{ section: '030000001', risk: 5 }, { section: '030000002', risk: 9, eyes: 2 }, { section: 'x', risk: 1 },
        { section: '030000009', risk: 'high' }, { section: '030000008', risk: 1, eyes: 0 }],
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.saved, 2);
  });

  it('lists the highest risk first and unscored sections last', async () => {
    const res = await request('GET', '/api/streams/available', { cookie: cookies.risk3 });
    const order = res.body.streams.map((s) => s.label).filter((l) => l.startsWith('R '));
    assert.deepEqual(order, ['R high', 'R low', 'R none']);
    const high = res.body.streams.find((s) => s.label === 'R high');
    assert.equal(high.risk, 9);
    assert.equal(high.eyes, 2);
    assert.equal(high.watchers, 0);
    assert.equal(res.body.streams.find((s) => s.label === 'R low').eyes, 1, 'unlisted needs one watcher');
    const last = res.body.streams.at(-1);
    assert.equal(last.risk, null);
  });

  it('a section needing 2 takes a second volunteer, then leaves the list', async () => {
    for (const u of ['risk1', 'risk2']) {
      sessions[u] = (await request('POST', '/api/session', { cookie: cookies[u], body: {} })).body.session_id;
      const add = await request('POST', '/api/session/streams', {
        cookie: cookies[u], body: { session_id: sessions[u], stream_ids: [ids['R high']] },
      });
      assert.deepEqual(add.body.added.map((s) => s.id), [ids['R high']], `${u} can add it`);
      const list = (await request('GET', '/api/streams/available', { cookie: cookies.risk3 })).body.streams;
      const row = list.find((s) => s.id === ids['R high']);
      if (u === 'risk1') assert.equal(row.watchers, 1, 'still offered with one watcher');
      else assert.equal(row, undefined, 'gone with two watchers');
    }
    sessions.risk3 = (await request('POST', '/api/session', { cookie: cookies.risk3, body: {} })).body.session_id;
    const third = await request('POST', '/api/session/streams', {
      cookie: cookies.risk3, body: { session_id: sessions.risk3, stream_ids: [ids['R high']] },
    });
    assert.deepEqual(third.body.added, []);
  });
});

// ── A section without a link is never flagged ────────────────────────────────

describe('Reports on a section without a link', () => {
  it('a stale page reporting "frozen" on a stub is stored as waiting and not flagged', async () => {
    await request('POST', '/api/users', { cookie: adminCookie, body: { username: 'stale1', password: 'volpass123', role: 'volunteer' } });
    const cookie = await login('stale1', 'volpass123');
    await request('POST', '/api/streams/upsert', {
      cookie: adminCookie, body: [{ section: '050000001', url: '', label: 'Stub withdrawn', assigned_users: 'stale1' }],
    });
    const session = await request('POST', '/api/session', { cookie, body: {} });
    const stub = session.body.streams.find((s) => s.section === '050000001');
    const rep = await request('POST', '/api/report', {
      cookie, body: { session_id: session.body.session_id, results: [{ stream_id: stub.id, status: 'frozen' }] },
    });
    assert.equal(rep.status, 200);
    const flagged = await request('GET', '/api/flagged', { cookie: adminCookie });
    assert.ok(!flagged.body.flagged.some((f) => f.stream_id === stub.id));
  });
});

describe('Section picker: a section needing one watcher', () => {
  it('leaves the list once one volunteer watches it, and refuses a second', async () => {
    const cookies = {};
    for (const u of ['eye1', 'eye2']) {
      await request('POST', '/api/users', { cookie: adminCookie, body: { username: u, password: 'volpass123', role: 'volunteer' } });
      cookies[u] = await login(u, 'volpass123');
    }
    await request('POST', '/api/streams/upsert', { cookie: adminCookie, body: [{ section: '060000001', url: 'https://example.test/e1.mp4', label: 'One eye' }] });
    const id = (await request('GET', '/api/streams', { cookie: adminCookie })).body.streams.find((s) => s.section === '060000001').id;
    const s1 = (await request('POST', '/api/session', { cookie: cookies.eye1, body: {} })).body.session_id;
    const a1 = await request('POST', '/api/session/streams', { cookie: cookies.eye1, body: { session_id: s1, stream_ids: [id] } });
    assert.deepEqual(a1.body.added.map((s) => s.id), [id]);
    const list = (await request('GET', '/api/streams/available', { cookie: cookies.eye2 })).body.streams;
    assert.ok(!list.some((s) => s.id === id));
    const s2 = (await request('POST', '/api/session', { cookie: cookies.eye2, body: {} })).body.session_id;
    const a2 = await request('POST', '/api/session/streams', { cookie: cookies.eye2, body: { session_id: s2, stream_ids: [id] } });
    assert.ok(!a2.body.added.some((s) => s.id === id));
  });
});

describe('Login fills the session with the highest-risk sections that need watchers', () => {
  it('assigned sections first, then unassigned by risk up to 3, never a section already full', async () => {
    await request('POST', '/api/users', { cookie: adminCookie, body: { username: 'fill1', password: 'volpass123', role: 'volunteer' } });
    await request('POST', '/api/users', { cookie: adminCookie, body: { username: 'fill2', password: 'volpass123', role: 'volunteer' } });
    const rows = [{ section: '070000001', url: 'https://example.test/f0.mp4', label: 'F own', assigned_users: 'fill1' }];
    for (let i = 2; i <= 7; i++) rows.push({ section: `07000000${i}`, url: `https://example.test/f${i}.mp4`, label: `F${i}` });
    rows.push({ section: '070000009', url: 'https://example.test/f9.mp4', label: 'F other', assigned_users: 'someone' });
    await request('POST', '/api/streams/upsert', { cookie: adminCookie, body: rows });
    await request('POST', '/api/streams/risk', {
      cookie: adminCookie,
      body: [{ section: '070000009', risk: 99 }, { section: '070000002', risk: 80, eyes: 1 }, { section: '070000003', risk: 70, eyes: 2 },
        { section: '070000004', risk: 60 }, { section: '070000005', risk: 50 }],
    });
    const s1 = await request('POST', '/api/session', { cookie: await login('fill1', 'volpass123'), body: {} });
    assert.deepEqual(s1.body.streams.map((s) => s.label), ['F own', 'F2', 'F3']);
    // F2 needs 1 watcher and has it; F3 needs 2; F other belongs to someone else
    const s2 = await request('POST', '/api/session', { cookie: await login('fill2', 'volpass123'), body: {} });
    assert.deepEqual(s2.body.streams.slice(0, 2).map((s) => s.label), ['F3', 'F4']);
    assert.equal(s2.body.streams.length, 3);
    assert.ok(!s2.body.streams.some((s) => ['F2', 'F other', 'F own'].includes(s.label)));
  });
});
