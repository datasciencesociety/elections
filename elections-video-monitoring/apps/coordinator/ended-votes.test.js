'use strict';

// A section counts as ended (shared with every page, skipped by distribution) only once 2 different
// volunteers have reported it ended (ENDED_MIN_VOTERS, default 2). One volunteer's second session does
// not count twice; 'live'/'ok' or a new link wipes the votes. Run: node --test ended-votes.test.js

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
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
    srv.on('error', reject);
  });
}

let base, child, adminCookie, id, startupLog = '';
const URL1 = 'https://live.example.test/x/060000001/index.m3u8';

async function request(method, urlPath, { body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(base + urlPath, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  const raw = await res.text();
  let parsed; try { parsed = JSON.parse(raw); } catch { parsed = raw; }
  return { status: res.status, body: parsed };
}
async function login(username, password = 'volpass123') {
  const res = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
  assert.equal(res.status, 200, `login ${username}`);
  return res.headers.get('set-cookie').split(';')[0];
}
async function volunteer(username) {
  const cookie = await login(username);
  const s = (await request('POST', '/api/session', { cookie, body: {} })).body;
  assert.ok(s.streams.some((x) => x.id === id), `${username} watches the section`);
  return { cookie, sid: s.session_id };
}
const report = (v, status, extra = {}) =>
  request('POST', '/api/report', { cookie: v.cookie, body: { session_id: v.sid, results: [{ stream_id: id, status, ...extra }] } });
const endedOf = async (v) => (await request('POST', '/api/heartbeat', { cookie: v.cookie, body: { session_id: v.sid } })).body.ended;
const statsEnded = async () => (await request('GET', '/api/streams/stats')).body.ended;
const min = (hhmm) => Date.now() - hhmm * 60_000;

before(async () => {
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coord-votes-'));
  const env = {
    ...process.env, PORT: String(port), DB_PATH: path.join(tmpDir, 'test.db'), ADMIN_USER: 'testadmin', ADMIN_PASS: 'testadminpass',
    COOKIE_SECRET: 'test-secret', PROXY_URL: 'http://127.0.0.1:1', RELEASE: 'votes-test', LOGIN_CARDS: '1',
    ENDED_AFTER: new Date(Date.now() - 60 * 60_000).toISOString(), // an hour ago: ends count from the start
  };
  delete env.TOPUP_AFTER; delete env.AUTOFILL_AFTER; delete env.ENDED_MIN_VOTERS; // the default: 2
  child = spawn(process.execPath, [path.join(__dirname, 'server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start')), 10_000);
    child.stdout.on('data', (d) => { startupLog += d; if (startupLog.includes('Election monitor')) { clearTimeout(timer); resolve(); } });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited ${code}`)); });
  });
  adminCookie = await login('testadmin', 'testadminpass');
  const users = ['v1', 'v2', 'v3'].map((username) => ({ username, password: 'volpass123', role: 'volunteer' }));
  assert.equal((await request('POST', '/api/users/bulk', { cookie: adminCookie, body: users })).status, 201);
  assert.equal((await request('POST', '/api/streams/upsert', { cookie: adminCookie, body: [{ section: '060000001', url: URL1, label: 'V1' }] })).status, 200);
  // 5 watchers wanted, so every volunteer gets it
  assert.equal((await request('POST', '/api/streams/risk', { cookie: adminCookie, body: [{ section: '060000001', risk: 50, eyes: 5 }] })).status, 200);
  id = (await request('GET', '/api/streams', { cookie: adminCookie })).body.streams[0].id;
});

after(() => { if (child) child.kill(); });

describe('Ended needs 2 different volunteers', () => {
  let v1, v1b, v2, v3;

  it('logs the rule at startup', () => {
    assert.match(startupLog, /by 2 volunteers/);
  });

  it('one volunteer, even from two sessions, does not end the section', async () => {
    v1 = await volunteer('v1');
    v1b = await volunteer('v1'); // the same volunteer on a second device
    v2 = await volunteer('v2');
    await report(v1, 'ended', { stopped_at: min(20) });
    await report(v1b, 'ended', { stopped_at: min(18) });
    assert.deepEqual(await endedOf(v1), {});
    assert.deepEqual(await endedOf(v2), {});
    assert.equal(await statsEnded(), 0);
  });

  it('a second volunteer ends it for everyone, showing the earliest stop time', async () => {
    const t = min(16);
    await report(v2, 'ended', { stopped_at: t });
    const e1 = await endedOf(v1);
    assert.deepEqual(Object.keys(e1).map(Number), [id]);
    assert.ok(Math.abs(e1[id] - min(20)) < 5_000, "v1's earlier stop time is shown");
    v3 = await volunteer('v3').catch(() => null); // distribution skips it now: v3 does not get it
    assert.equal(v3, null, 'an ended section is not handed out');
    assert.equal(await statsEnded(), 1);
  });

  it("'live' clears the mark and the votes: one new vote does not end it again", async () => {
    await report(v1, 'live');
    assert.deepEqual(await endedOf(v2), {});
    await report(v2, 'ended', { stopped_at: min(5) });
    assert.deepEqual(await endedOf(v1), {}, 'the old votes are gone');
    await report(v1, 'ended', { stopped_at: min(4) });
    assert.deepEqual(Object.keys(await endedOf(v2)).map(Number), [id], 'two fresh votes end it');
  });

  it("'ok' clears it too, and a new link wipes the votes", async () => {
    await report(v2, 'ok');
    assert.deepEqual(await endedOf(v1), {});
    await report(v1, 'ended', { stopped_at: min(3) });
    const res = await request('POST', '/api/streams/upsert', { cookie: adminCookie, body: [{ section: '060000001', url: URL1.replace('/x/', '/y/'), label: 'V1' }] });
    assert.equal(res.status, 200);
    await report(v2, 'ended', { stopped_at: min(2) });
    assert.deepEqual(await endedOf(v1), {}, "v1's vote was for the old link");
  });
});
