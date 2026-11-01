'use strict';

// Simulation of the 2-volunteer rule in real pages: volunteers A and B watch the same stream, which
// plays and then answers an empty playlist (as evideo does once a stream stops). A's own 15 minutes run
// out first: A shows "Не излъчва от 21:07" but the server shares nothing (one vote). When B's own
// time runs out too, the server marks the section ended for everyone with the earliest stop time.
// Segments return: A revives it, the votes are wiped and B follows. Same fake clock/origin as
// volunteer-ended-shared.e2e.test.js; nothing reaches evideo.
// Needs Playwright's Chromium: node --test volunteer-ended-votes.e2e.test.js

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { chromium } = require('@playwright/test');

const EMPTY_BODY = '';
const LIVE = '#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXT-X-MEDIA-SEQUENCE:1\n#EXTINF:4.0,\nseg1.ts\n';
const SECTION = '060000001';
const URL_LIVE = `https://live-0001.evideo.bg/pvr2026/${SECTION}/index.m3u8`;
const sofia = (hhmm, ss = '00') => new Date(`2026-11-01T${hhmm}:${ss}+02:00`); // winter time, UTC+2
const SERVER_NOW = sofia('21:25').getTime();

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
    srv.on('error', reject);
  });
}

let child, browser, base, adminCookie;
let body = LIVE; // what the playlist (and variant) answers, for every page

async function api(method, urlPath, reqBody, cookie) {
  const res = await fetch(base + urlPath, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: reqBody === undefined ? undefined : JSON.stringify(reqBody),
  });
  return { status: res.status, cookie: (res.headers.get('set-cookie') || '').split(';')[0], text: await res.text() };
}

before(async () => {
  const port = await freePort();
  base = `http://localhost:${port}`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'coord-e2e-shared-'));
  const preload = path.join(tmp, 'clock.js');
  fs.writeFileSync(preload, 'const off = Number(process.env.TEST_CLOCK_OFFSET_MS); const real = Date.now; Date.now = () => real() + off;\n');
  const env = {
    ...process.env, PORT: String(port), DB_PATH: path.join(tmp, 'e2e.db'), ADMIN_USER: 'admin', ADMIN_PASS: 'adminpass123',
    COOKIE_SECRET: 'e2e', PROXY_URL: '/hls', TEST_CLOCK_OFFSET_MS: String(SERVER_NOW - Date.now()),
  };
  delete env.ENDED_AFTER; // the default, 21:00 Sofia, on server and page
  delete env.ENDED_MIN_VOTERS; // the default: 2 different volunteers
  delete env.TOPUP_AFTER;
  delete env.AUTOFILL_AFTER;
  child = spawn(process.execPath, ['-r', preload, path.join(__dirname, 'server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start:\n${stderr}`)), 10_000);
    child.stdout.on('data', (d) => { if (d.toString().includes('Election monitor')) { clearTimeout(timer); resolve(); } });
  });
  adminCookie = (await api('POST', '/api/login', { username: 'admin', password: 'adminpass123' })).cookie;
  for (const user of ['vola', 'volb', 'volold']) {
    assert.equal((await api('POST', '/api/users', { username: user, password: 'volpass123', role: 'volunteer' }, adminCookie)).status, 201);
  }
  // The same section for all three
  assert.equal((await api('POST', '/api/streams/upsert', [{ section: SECTION, url: URL_LIVE, label: 'Shared', assigned_users: 'vola,volb,volold' }], adminCookie)).status, 200);
  browser = await chromium.launch();
});

after(async () => {
  if (browser) await browser.close();
  if (child) child.kill();
});

// oldHtml: serve this volunteer.html instead of the current one (with the server's injected settings)
async function openVolunteer(user, at, oldHtml) {
  const page = await browser.newPage();
  await page.clock.setFixedTime(at);
  const reports = [];
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*', async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    if (u.hostname !== 'localhost') return route.abort();
    if (u.pathname === '/api/report') { reports.push(req.postDataJSON()); return route.continue(); }
    if (u.pathname === '/' && oldHtml && req.method() === 'GET') {
      const res = await route.fetch();
      const injected = (await res.text()).match(/<script>window\.PROXY_BASE[^\n]*<\/script>/)[0];
      return route.fulfill({ response: res, body: oldHtml.replace('</head>', injected + '\n</head>') });
    }
    if (!u.pathname.startsWith('/hls/')) return route.continue();
    if (req.resourceType() === 'media') return undefined; // left pending: the card never errors into direct playback
    return route.fulfill({ status: 200, contentType: 'application/vnd.apple.mpegurl', body });
  });
  await page.goto(base + '/login');
  await page.fill('#username', user);
  await page.fill('#password', 'volpass123');
  await page.click('#submit-btn');
  await page.waitForURL(base + '/');
  await page.waitForFunction(() => streamStates.length >= 1);
  await page.waitForFunction(() => !streamStates[0].probing, null, { timeout: 5000 });

  const state = () => page.evaluate(() => {
    const s = streamStates[0];
    return {
      status: s.status, src: s.video ? s.video.getAttribute('src') : null, emptySince: s.emptySince || null,
      text: s.card.querySelector('.status-text').textContent, cards: streamStates.length,
      online: document.getElementById('vol-indicator').classList.contains('active'),
    };
  });
  const probeAt = async (t) => {
    await page.clock.setFixedTime(t);
    await page.evaluate(async () => {
      while (streamStates[0].endProbing) await new Promise((r) => setTimeout(r, 20));
      await probeEnded(streamStates[0]);
    });
  };
  const heartbeatAt = async (t) => {
    await page.clock.setFixedTime(t);
    await page.evaluate(() => sendHeartbeat());
  };
  const settled = () => page.waitForFunction(() => !streamStates[0].transition); // the change reached the server
  return { page, reports, errors, state, probeAt, heartbeatAt, settled };
}

const SHOTS = process.env.SHOT_DIR; // optional: save card screenshots here
const shot = async (v, name) => { if (SHOTS) await v.page.locator('.stream-card, .card').first().screenshot({ path: path.join(SHOTS, name + '.png') }).catch(() => {}); };
const stats = async () => JSON.parse((await api('GET', '/api/streams/stats')).text);

describe('Ended needs 2 volunteers (simulation)', () => {
  it('one volunteer is not enough; the second ends it for both; segments back revive it for both', async () => {
    body = LIVE;
    const a = await openVolunteer('vola', sofia('21:05'));
    const b = await openVolunteer('volb', sofia('21:05'));
    const id = await a.page.evaluate(() => streamStates[0].id);
    assert.equal(await b.page.evaluate(() => streamStates[0].id), id, 'both watch the same section');

    // The stream stops: empty playlist. A notices at 21:07, B at 21:10
    body = EMPTY_BODY;
    await a.probeAt(sofia('21:07'));
    await b.probeAt(sofia('21:10'));

    // 21:22: A's own 15 minutes are up
    await a.probeAt(sofia('21:22'));
    assert.equal((await a.state()).status, 'ended');
    assert.equal((await a.state()).text, 'Не излъчва от 21:07');
    await a.settled();
    await shot(a, '1-A-ended-alone');
    // One vote: nothing is shared
    await b.heartbeatAt(sofia('21:22', '30'));
    assert.notEqual((await b.state()).status, 'ended', 'B is not told: only one volunteer reported');
    assert.equal((await stats()).ended, 0, 'admin: nothing ended yet');
    await shot(b, '2-B-still-waiting');

    // 21:25: B's own 15 minutes are up; second volunteer → shared
    await b.probeAt(sofia('21:25'));
    assert.equal((await b.state()).status, 'ended');
    await b.settled();
    assert.equal((await stats()).ended, 1, 'admin: one section ended');
    await b.heartbeatAt(sofia('21:25', '30'));
    assert.equal((await b.state()).text, 'Не излъчва от 21:07', 'B shows the earliest stop time, from the server');
    await a.heartbeatAt(sofia('21:25', '30'));
    assert.equal((await a.state()).text, 'Не излъчва от 21:07');
    await shot(b, '3-B-ended-shared');

    // Segments return: A's 2-min recheck revives the card, sends 'live', the server wipes the votes
    body = LIVE;
    await a.probeAt(sofia('21:27'));
    assert.notEqual((await a.state()).status, 'ended');
    await a.settled();
    assert.equal((await stats()).ended, 0, 'admin: back to live');
    await b.heartbeatAt(sofia('21:27', '30'));
    await b.page.waitForFunction(() => streamStates[0].status !== 'ended' && !streamStates[0].endProbing);
    assert.match((await b.state()).src || '', /^\/hls\//, 'B plays again');
    await shot(b, '4-B-live-again');
    assert.deepEqual([...a.errors, ...b.errors], []);
    await a.page.close();
    await b.page.close();
  });
});
