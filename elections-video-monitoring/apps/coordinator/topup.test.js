'use strict';

// The test card for everyone (assigned_users '*') and distribution by risk from TOPUP_AFTER.
// Boots the real server.js on a temp DB with TOPUP_AFTER a few seconds ahead, checks the sessions
// before that time, waits for it, and checks that heartbeats then fill the sessions.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const LEAD_MS = 8_000; // time before TOPUP_AFTER for the "before" cases

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

let base, child, adminCookie, topupAt, ids;

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
const resume = async (cookie, session_id) => (await request('POST', '/api/session', { cookie, body: { session_id } })).body;
const toggle = (id, enabled) => request('POST', '/api/streams/toggle', { cookie: adminCookie, body: { id, enabled } });
const labels = (streams) => streams.map((s) => s.label).sort();
const beforeTopup = () => assert.ok(Date.now() < topupAt - 500, 'test ran too slowly: TOPUP_AFTER already passed');

before(async () => {
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coord-topup-'));
  topupAt = Date.now() + LEAD_MS;
  child = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    env: {
      ...process.env,
      PORT: String(port),
      DB_PATH: path.join(tmpDir, 'test.db'),
      ADMIN_USER: 'testadmin',
      ADMIN_PASS: 'testadminpass',
      COOKIE_SECRET: 'test-secret',
      PROXY_URL: 'http://127.0.0.1:1',
      TOPUP_AFTER: new Date(topupAt).toISOString(),
      RELEASE: 'topup-test',
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
  const users = ['early1', 'early2', 'late1'].map((username) => ({ username, password: 'volpass123', role: 'volunteer' }));
  assert.equal((await request('POST', '/api/users/bulk', { cookie: adminCookie, body: users })).status, 201);
  const rows = [{ section: '999000001', url: 'https://archive.example.test/test.mp4', label: 'Test card', assigned_users: '*' }];
  for (let i = 1; i <= 5; i++) rows.push({ section: `08000000${i}`, url: '', label: `R${i}` });
  assert.equal((await request('POST', '/api/streams/upsert', { cookie: adminCookie, body: rows })).status, 200);
  // R5 highest; R1 lowest
  const risk = [1, 2, 3, 4, 5].map((i) => ({ section: `08000000${i}`, risk: i * 10 }));
  assert.equal((await request('POST', '/api/streams/risk', { cookie: adminCookie, body: risk })).status, 200);
  const all = (await request('GET', '/api/streams', { cookie: adminCookie })).body.streams;
  ids = Object.fromEntries(all.map((s) => [s.label, s.id]));
});

after(() => { if (child) child.kill(); });

describe('Test card for everyone, sections by risk from TOPUP_AFTER', () => {
  let early1Cookie, early1, early2Cookie, early2;

  it('before TOPUP_AFTER a volunteer gets only the test card, also on heartbeat and resume', async () => {
    early1Cookie = await login('early1');
    early1 = await newSession(early1Cookie);
    beforeTopup();
    assert.deepEqual(labels(early1.streams), ['Test card']);
    const hb = await heartbeat(early1Cookie, early1.session_id);
    assert.equal(hb.body.ok, true);
    assert.deepEqual(labels(hb.body.assigned_streams), ['Test card']);
    assert.equal(hb.body.release, 'topup-test');
    assert.deepEqual(labels((await resume(early1Cookie, early1.session_id)).streams), ['Test card']);
    beforeTopup();
  });

  it('before TOPUP_AFTER the section picker is empty and adding a section adds nothing', async () => {
    beforeTopup();
    const list = (await request('GET', '/api/streams/available', { cookie: early1Cookie })).body.streams;
    assert.deepEqual(list, []);
    const add = await request('POST', '/api/session/streams', { cookie: early1Cookie, body: { session_id: early1.session_id, stream_ids: [ids.R5] } });
    assert.equal(add.status, 200);
    assert.deepEqual(add.body.added, []);
    assert.deepEqual(labels((await resume(early1Cookie, early1.session_id)).streams), ['Test card']);
    beforeTopup();
  });

  it('before TOPUP_AFTER with the test card disabled: an empty session, no random cards', async () => {
    assert.equal((await toggle(ids['Test card'], 0)).status, 200);
    early2Cookie = await login('early2');
    early2 = await newSession(early2Cookie);
    beforeTopup();
    assert.deepEqual(early2.streams, []);
    const hb = await heartbeat(early2Cookie, early2.session_id);
    assert.deepEqual(hb.body.assigned_streams, []);
    beforeTopup();
    assert.equal((await toggle(ids['Test card'], 1)).status, 200);
  });

  it('after TOPUP_AFTER the section picker lists sections, never the test card', async () => {
    await new Promise((r) => setTimeout(r, Math.max(0, topupAt - Date.now() + 200)));
    const list = (await request('GET', '/api/streams/available', { cookie: early1Cookie })).body.streams;
    assert.ok(list.length > 0);
    assert.ok(!list.some((s) => s.id === ids['Test card']));
  });

  it('after TOPUP_AFTER a heartbeat adds the 3 highest-risk sections next to the test card', async () => {
    await new Promise((r) => setTimeout(r, Math.max(0, topupAt - Date.now() + 200)));
    const hb = await heartbeat(early1Cookie, early1.session_id);
    assert.deepEqual(labels(hb.body.assigned_streams), ['R3', 'R4', 'R5', 'Test card']);
    assert.deepEqual(labels((await resume(early1Cookie, early1.session_id)).streams), ['R3', 'R4', 'R5', 'Test card']);
    // The empty session gets the test card back (enabled again) and the next 3 by risk
    const hb2 = await heartbeat(early2Cookie, early2.session_id);
    assert.deepEqual(labels(hb2.body.assigned_streams), ['R1', 'R2', 'Test card']);
  });

  it('a full session gets nothing more', async () => {
    const hb = await heartbeat(early1Cookie, early1.session_id);
    assert.deepEqual(labels(hb.body.assigned_streams), ['Test card'], 'only the pre-assigned card is listed');
    assert.equal((await resume(early1Cookie, early1.session_id)).streams.length, 4);
  });

  it('login after TOPUP_AFTER with every section covered: the test card, and a new section on the next heartbeat', async () => {
    // Every R section has its one watcher, so a new volunteer only gets the test card
    const lateCookie = await login('late1');
    const late = await newSession(lateCookie);
    assert.deepEqual(labels(late.streams), ['Test card']);
    // A new section with a risk score is handed out on the next heartbeat
    await request('POST', '/api/streams/upsert', { cookie: adminCookie, body: [{ section: '080000009', url: '', label: 'R9' }] });
    await request('POST', '/api/streams/risk', { cookie: adminCookie, body: [{ section: '080000009', risk: 90 }] });
    const hb = await heartbeat(lateCookie, late.session_id);
    assert.deepEqual(labels(hb.body.assigned_streams), ['R9', 'Test card']);
  });

  it('a disabled test card leaves the session and frees no slot for a 4th section', async () => {
    await request('POST', '/api/streams/upsert', { cookie: adminCookie, body: [{ section: '080000010', url: '', label: 'R10' }] });
    await request('POST', '/api/streams/risk', { cookie: adminCookie, body: [{ section: '080000010', risk: 100 }] });
    assert.equal((await toggle(ids['Test card'], 0)).status, 200);
    const hb = await heartbeat(early1Cookie, early1.session_id);
    // Not in assigned_streams: the page removes it. Its URL reads as withdrawn for older pages.
    assert.deepEqual(hb.body.assigned_streams, []);
    assert.equal(hb.body.urls[ids['Test card']], '');
    // A reload (resume) no longer brings it back, and the session still has its 3 sections
    assert.deepEqual(labels((await resume(early1Cookie, early1.session_id)).streams), ['R3', 'R4', 'R5']);
    const hb2 = await heartbeat(early1Cookie, early1.session_id);
    assert.ok(!(ids['Test card'] in hb2.body.urls));
  });

  it('re-enabling the test card hands it back to open sessions', async () => {
    assert.equal((await toggle(ids['Test card'], 1)).status, 200);
    const hb = await heartbeat(early1Cookie, early1.session_id);
    assert.deepEqual(labels(hb.body.assigned_streams), ['Test card']);
    assert.equal(hb.body.urls[ids['Test card']], 'https://archive.example.test/test.mp4');
  });

  it('the page is served with its release', async () => {
    const html = (await request('GET', '/', { cookie: early1Cookie })).body;
    assert.match(html, /window\.RELEASE = "topup-test"/);
  });
});

describe('An unparsable TOPUP_AFTER', () => {
  it('stops the server at startup instead of handing out sections early', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coord-topup-bad-'));
    const bad = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
      env: { ...process.env, PORT: String(await freePort()), DB_PATH: path.join(tmpDir, 'test.db'), ALLOW_NEW_DB: '1',
        COOKIE_SECRET: 'x', TOPUP_AFTER: '2026-11-01 16.00' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let err = '';
    bad.stderr.on('data', (d) => { err += d; });
    const code = await new Promise((resolve) => bad.on('exit', resolve));
    assert.equal(code, 1);
    assert.match(err, /TOPUP_AFTER=.*is not a date/);
  });
});
