'use strict';

// Shared "stream ended" state per section. Boots the real server.js on a temp DB with ENDED_AFTER a few
// seconds ahead: 'ended' reports before it are ignored, after it they set the state; 'live' and 'ok'
// reports and a new link clear it. Heartbeats list the session's ended sections; distribution, the
// section picker, autofill and the flagged list skip them. Run: node --test ended.test.js

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { DatabaseSync } = require('node:sqlite');

const LEAD_MS = 6_000; // time before ENDED_AFTER for the "before" case

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
    srv.on('error', reject);
  });
}

let base, child, adminCookie, endedAt, ids, dbPath;

async function request(method, urlPath, { body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(base + urlPath, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  const raw = await res.text();
  let parsed;
  try { parsed = JSON.parse(raw); } catch { parsed = raw; }
  return { status: res.status, body: parsed };
}

async function login(username, password = 'volpass123') {
  const res = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
  assert.equal(res.status, 200, `login ${username}`);
  return res.headers.get('set-cookie').split(';')[0];
}

const newSession = async (cookie) => (await request('POST', '/api/session', { cookie, body: {} })).body;
const heartbeatRaw = async (cookie, session_id) => (await request('POST', '/api/heartbeat', { cookie, body: { session_id } })).body;
// ended comes as {id: stopped_at}; most tests compare the ids
const heartbeat = async (cookie, session_id) => {
  const hb = await heartbeatRaw(cookie, session_id);
  return { ...hb, ended: Object.keys(hb.ended).map(Number) };
};
const report = (cookie, session_id, stream_id, status, extra = {}) =>
  request('POST', '/api/report', { cookie, body: { session_id, results: [{ stream_id, status, ...extra }] } });
const available = async (cookie) => (await request('GET', '/api/streams/available', { cookie })).body.streams.map((s) => s.id);
const stats = async () => (await request('GET', '/api/streams/stats')).body;
const endedFlag = async (id) => (await request('GET', '/api/streams', { cookie: adminCookie })).body.streams.find((s) => s.id === id).ended;
const flaggedIds = async () => (await request('GET', '/api/flagged', { cookie: adminCookie })).body.flagged.map((f) => f.stream_id);

before(async () => {
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coord-ended-'));
  dbPath = path.join(tmpDir, 'test.db');
  endedAt = Date.now() + LEAD_MS;
  const env = {
    ...process.env, PORT: String(port), DB_PATH: dbPath, ADMIN_USER: 'testadmin', ADMIN_PASS: 'testadminpass',
    COOKIE_SECRET: 'test-secret', PROXY_URL: 'http://127.0.0.1:1', RELEASE: 'ended-test',
    ENDED_MIN_VOTERS: '1', ENDED_AFTER: new Date(endedAt).toISOString(), AUTOFILL_AFTER: '2020-01-01T00:00:00Z', AUTOFILL_MAX: '5', LOGIN_CARDS: '3',
  };
  delete env.TOPUP_AFTER;
  child = spawn(process.execPath, [path.join(__dirname, 'server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start')), 10_000);
    child.stdout.on('data', (d) => { if (d.toString().includes('Election monitor')) { clearTimeout(timer); resolve(); } });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited ${code}`)); });
  });
  adminCookie = await login('testadmin', 'testadminpass');
  const users = ['va', 'vb', 'vc', 'vd', 'owner'].map((username) => ({ username, password: 'volpass123', role: 'volunteer' }));
  assert.equal((await request('POST', '/api/users/bulk', { cookie: adminCookie, body: users })).status, 201);
  const rows = [];
  for (let i = 1; i <= 4; i++) rows.push({ section: `07000000${i}`, url: `https://live.example.test/x/07000000${i}/index.m3u8`, label: `E${i}` });
  assert.equal((await request('POST', '/api/streams/upsert', { cookie: adminCookie, body: rows })).status, 200);
  // E4 highest risk and needs 3 watchers, so it would go to every new session
  const risk = [1, 2, 3, 4].map((i) => ({ section: `07000000${i}`, risk: i * 10, eyes: i === 4 ? 3 : 1 }));
  assert.equal((await request('POST', '/api/streams/risk', { cookie: adminCookie, body: risk })).status, 200);
  const all = (await request('GET', '/api/streams', { cookie: adminCookie })).body.streams;
  ids = Object.fromEntries(all.map((s) => [s.label, s.id]));
});

after(() => { if (child) child.kill(); });

describe('Shared ended state', () => {
  let vaCookie, va, vbCookie, vb;

  it('before ENDED_AFTER an ended report is stored but ends nothing', async () => {
    vaCookie = await login('va');
    va = await newSession(vaCookie);
    assert.ok(va.streams.some((s) => s.id === ids.E4), 'E4 (highest risk) given out');
    assert.equal((await report(vaCookie, va.session_id, ids.E4, 'ended')).status, 200);
    const hb = await heartbeat(vaCookie, va.session_id);
    assert.ok(Date.now() < endedAt, 'test ran too slowly: ENDED_AFTER already passed');
    assert.deepEqual(hb.ended, []);
    assert.equal((await stats()).ended, 0);
    assert.equal(await endedFlag(ids.E4), 0);
  });

  it('the heartbeat keeps every field older pages read', async () => {
    const hb = await heartbeatRaw(vaCookie, va.session_id);
    assert.deepEqual(hb.ended, {});
    for (const k of ['ok', 'assigned_streams', 'urls', 'release', 'ended']) assert.ok(k in hb, k);
    assert.equal(hb.ok, true);
  });

  it('after ENDED_AFTER an ended report ends the section for every session that has it', async () => {
    vbCookie = await login('vb');
    vb = await newSession(vbCookie);
    assert.ok(vb.streams.some((s) => s.id === ids.E4), 'vb watches E4 too');
    while (Date.now() < endedAt + 200) await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual((await heartbeat(vbCookie, vb.session_id)).ended, [], 'the report before ENDED_AFTER still counts for nothing');
    await report(vaCookie, va.session_id, ids.E4, 'ended');
    assert.deepEqual((await heartbeat(vaCookie, va.session_id)).ended, [ids.E4]);
    assert.deepEqual((await heartbeat(vbCookie, vb.session_id)).ended, [ids.E4]);
    assert.equal((await stats()).ended, 1);
    assert.equal(await endedFlag(ids.E4), 1);
  });

  it('only a session watching the section can end it; identity comes from the cookie', async () => {
    const vcCookie = await login('vc');
    const vc = await newSession(vcCookie);
    const vaOther = va.streams.map((s) => s.id).filter((id) => id !== ids.E4);
    const notVc = [ids.E1, ids.E2, ids.E3].find((id) => !vc.streams.some((s) => s.id === id));
    assert.ok(notVc, 'a section vc does not have');
    await report(vcCookie, vc.session_id, notVc, 'ended'); // not in vc's session
    const other = await report(vcCookie, va.session_id, vaOther[0], 'ended'); // va's session with vc's cookie
    assert.equal(other.status, 400);
    const noLogin = await request('POST', '/api/report', { body: { session_id: va.session_id, results: [{ stream_id: vaOther[0], status: 'ended' }] } });
    assert.ok(noLogin.status === 401 || noLogin.status === 302, `no login: ${noLogin.status}`);
    assert.deepEqual((await heartbeat(vaCookie, va.session_id)).ended, [ids.E4], 'nothing else ended');
    assert.equal((await stats()).ended, 1);
  });

  it('distribution and the section picker skip ended sections', async () => {
    const vdCookie = await login('vd');
    const vd = await newSession(vdCookie);
    assert.ok(!vd.streams.some((s) => s.id === ids.E4), 'E4 still needs a third watcher but has ended');
    assert.ok(!(await available(vdCookie)).includes(ids.E4));
    assert.ok(!(await heartbeat(vdCookie, vd.session_id)).assigned_streams.some((s) => s.id === ids.E4));
  });

  it('frozen, dark and covered reports neither clear it nor flag the ended section', async () => {
    for (const st of ['frozen', 'dark', 'covered', 'loading', 'waiting', 'error']) await report(vaCookie, va.session_id, ids.E4, st);
    await report(vbCookie, vb.session_id, ids.E4, 'frozen');
    assert.deepEqual((await heartbeat(vbCookie, vb.session_id)).ended, [ids.E4]);
    const e3 = va.streams.find((s) => s.id !== ids.E4).id;
    await report(vaCookie, va.session_id, e3, 'frozen');
    const flagged = await flaggedIds();
    assert.ok(!flagged.includes(ids.E4), 'ended section not flagged');
    assert.ok(flagged.includes(e3), 'a live frozen section still is');
  });

  it("a 'live' report clears it; ended and live are never flags", async () => {
    await report(vbCookie, vb.session_id, ids.E4, 'live');
    assert.deepEqual((await heartbeat(vaCookie, va.session_id)).ended, []);
    assert.equal((await stats()).ended, 0);
    assert.ok((await available(vaCookie)).includes(ids.E4), 'back in the picker');
    const flagged = (await request('GET', '/api/flagged', { cookie: adminCookie })).body.flagged;
    assert.ok(!flagged.some((f) => f.flag_type === 'ended' || f.flag_type === 'live'));
    assert.ok(flagged.some((f) => f.stream_id === ids.E4 && f.flag_type === 'frozen'), 'its frozen reports count again');
  });

  it('the heartbeat carries when the stream stopped, checked for sense', async () => {
    const t0 = Date.now();
    const fallback = (v, now) => Math.abs(v - (now - 15 * 60_000)) < 5_000; // now − 15 min
    const cases = [
      [t0 - 20 * 60_000, (v) => v === t0 - 20 * 60_000], // as the page saw it
      [t0 + 60 * 60_000, fallback], // in the future
      [t0 - 3 * 60 * 60_000, fallback], // over 2 h old
      ['x', fallback],
      [undefined, fallback],
    ];
    for (const [stopped, ok] of cases) {
      await report(vaCookie, va.session_id, ids.E4, 'ended', stopped === undefined ? {} : { stopped_at: stopped });
      const hb = await heartbeatRaw(vbCookie, vb.session_id);
      assert.deepEqual(Object.keys(hb.ended), [String(ids.E4)]);
      assert.ok(ok(hb.ended[ids.E4], Date.now()), `stopped_at ${stopped} → ${hb.ended[ids.E4]}`);
      // a second page's later report keeps the first time
      await report(vbCookie, vb.session_id, ids.E4, 'ended', { stopped_at: Date.now() - 60_000 });
      assert.equal((await heartbeatRaw(vaCookie, va.session_id)).ended[ids.E4], hb.ended[ids.E4]);
      await report(vaCookie, va.session_id, ids.E4, 'live');
    }
  });

  it("an 'ok' report (moving picture) clears it", async () => {
    await report(vaCookie, va.session_id, ids.E4, 'ended');
    assert.deepEqual((await heartbeat(vaCookie, va.session_id)).ended, [ids.E4]);
    await report(vbCookie, vb.session_id, ids.E4, 'ok');
    assert.deepEqual((await heartbeat(vaCookie, va.session_id)).ended, []);
  });

  it('a new link clears it; the same link or a stub does not', async () => {
    await report(vaCookie, va.session_id, ids.E4, 'ended');
    const same = { section: '070000004', url: 'https://live.example.test/x/070000004/index.m3u8', label: 'E4' };
    await request('POST', '/api/streams/upsert', { cookie: adminCookie, body: [same] });
    await request('POST', '/api/streams/upsert', { cookie: adminCookie, body: [{ ...same, url: '' }] });
    assert.deepEqual((await heartbeat(vaCookie, va.session_id)).ended, [ids.E4], 'same link and stub keep it');
    await request('POST', '/api/streams/upsert', { cookie: adminCookie, body: [{ ...same, url: 'https://live2.example.test/x/070000004/index.m3u8' }] });
    assert.deepEqual((await heartbeat(vaCookie, va.session_id)).ended, []);
  });

  it('a mark from before the current ENDED_AFTER (an earlier night) counts for nothing', async () => {
    const db = new DatabaseSync(dbPath);
    db.prepare('UPDATE streams SET ended_at = ? WHERE id = ?').run(endedAt - 1, ids.E4);
    db.close();
    assert.deepEqual((await heartbeat(vaCookie, va.session_id)).ended, []);
    assert.ok((await available(vaCookie)).includes(ids.E4));
    // ...and a new ended report replaces it
    await report(vaCookie, va.session_id, ids.E4, 'ended');
    assert.deepEqual((await heartbeat(vaCookie, va.session_id)).ended, [ids.E4]);
    await report(vaCookie, va.session_id, ids.E4, 'live');
  });

  it('backup cover (autofill) skips an ended section nobody watches', async () => {
    // Assigned to someone who never comes; added only now so no earlier heartbeat took them
    const orphans = ['070000011', '070000012'].map((section, i) =>
      ({ section, url: `https://live.example.test/x/${section}/index.m3u8`, label: `O${i + 1}`, assigned_users: 'owner' }));
    assert.equal((await request('POST', '/api/streams/upsert', { cookie: adminCookie, body: orphans })).status, 200);
    const all = (await request('GET', '/api/streams', { cookie: adminCookie })).body.streams;
    ids = Object.fromEntries(all.map((s) => [s.label, s.id]));
    const db = new DatabaseSync(dbPath);
    db.prepare('UPDATE streams SET ended_at = ? WHERE id = ?').run(Date.now(), ids.O1);
    db.close();
    // va has 3 cards; AUTOFILL_MAX 5 leaves room for both O1 and O2
    const hb = await heartbeat(vaCookie, va.session_id);
    const got = hb.assigned_streams.map((s) => s.id);
    assert.ok(got.includes(ids.O2), 'the live orphan is given');
    assert.ok(!got.includes(ids.O1), 'the ended orphan is not');
  });
});
