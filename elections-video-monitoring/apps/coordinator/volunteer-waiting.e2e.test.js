'use strict';

// Volunteer page in Chromium: "stream not yet started" cards and how they react to what /hls answers.
// Every /hls/ request is answered inside the browser and every non-localhost request is aborted,
// so nothing reaches evideo. Needs Playwright's Chromium: node --test volunteer-waiting.e2e.test.js

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { chromium } = require('@playwright/test');

const EMPTY = '#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXT-X-MEDIA-SEQUENCE:0\n';
const LIVE = '#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXT-X-MEDIA-SEQUENCE:1\n#EXTINF:4.0,\nseg1.ts\n';
const SECTION = '010100001';
const URL_LIVE = `https://live-0001.evideo.bg/pvr2026/${SECTION}/index.m3u8`;

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
    srv.on('error', reject);
  });
}

let child, browser, base, adminCookie, port, dbPath;

// Starts server.js on the shared port and DB; a restart keeps users, sessions and login cookies
async function startServer(env = {}) {
  child = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    env: { ...process.env, PORT: String(port), DB_PATH: dbPath, ADMIN_USER: 'admin', ADMIN_PASS: 'adminpass123', COOKIE_SECRET: 'e2e', PROXY_URL: '/hls', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start:\n${stderr}`)), 10_000);
    child.stdout.on('data', (d) => { if (d.toString().includes('Election monitor')) { clearTimeout(timer); resolve(); } });
  });
}

async function api(method, urlPath, body, cookie) {
  const res = await fetch(base + urlPath, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
}

before(async () => {
  port = await freePort();
  base = `http://localhost:${port}`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'coord-e2e-'));
  dbPath = path.join(tmp, 'e2e.db');
  await startServer({ RELEASE: 'e2e-a' });
  adminCookie = (await api('POST', '/api/login', { username: 'admin', password: 'adminpass123' })).cookie;
  browser = await chromium.launch();
});

after(async () => {
  if (browser) await browser.close();
  if (child) child.kill();
});

let userSeq = 0;

// A volunteer with one assigned stream; `answer(path)` decides each /hls/ response
async function openVolunteer(streamUrl, answer) {
  const user = `vol${++userSeq}`;
  assert.equal((await api('POST', '/api/users', { username: user, password: 'volpass123', role: 'volunteer' }, adminCookie)).status, 201);
  const section = String(20000000 + userSeq).padStart(9, '0');
  await api('POST', '/api/streams/upsert', [{ section, url: streamUrl.replace(SECTION, section), label: user, assigned_users: user }], adminCookie);

  const page = await browser.newPage();
  const hls = [];
  await page.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.hostname !== 'localhost') return route.abort();
    if (!u.pathname.startsWith('/hls/')) return route.continue();
    hls.push({ path: u.pathname, type: route.request().resourceType() });
    const { status = 200, body = '' } = answer(u.pathname);
    return route.fulfill({ status, contentType: 'application/vnd.apple.mpegurl', body });
  });
  await page.goto(base + '/login');
  await page.fill('#username', user);
  await page.fill('#password', 'volpass123');
  await page.click('#submit-btn');
  await page.waitForURL(base + '/');
  await page.waitForFunction(() => streamStates.length >= 1);
  const state = () => page.evaluate(() => {
    const s = streamStates[0];
    return { status: s.status, fallback: s.fallback, src: s.video ? s.video.getAttribute('src') : null, intervals: intervals.length };
  });
  // One probe, after any probe the page started itself: a tick during one is skipped by design
  const tick = () => page.evaluate(async () => {
    while (streamStates[0].probing) await new Promise((r) => setTimeout(r, 20));
    if (streamStates[0].status === 'waiting') await probeWaiting(streamStates[0]);
  });
  return { page, hls, state, tick };
}

describe('Volunteer card while the stream has not started', () => {
  it('an empty playlist at page load does not stall the page, and the card starts once segments appear', async () => {
    let body = EMPTY;
    const v = await openVolunteer(URL_LIVE, () => ({ body }));
    await v.page.waitForFunction(() => intervals.length > 0, null, { timeout: 5000 });
    assert.equal((await v.state()).status, 'waiting');
    assert.equal((await v.state()).src, null);
    body = LIVE;
    await v.tick();
    await v.page.waitForFunction(() => streamStates[0].status !== 'waiting', null, { timeout: 5000 });
    assert.ok(v.hls.some((r) => r.type === 'media'), 'the video element loaded the proxied playlist');
    await v.page.close();
  });

  it('404 keeps waiting', async () => {
    const v = await openVolunteer(URL_LIVE, () => ({ status: 404 }));
    await v.page.waitForFunction(() => intervals.length > 0, null, { timeout: 5000 });
    await v.tick();
    assert.equal((await v.state()).status, 'waiting');
    await v.page.close();
  });

  it('429 from the rate limit keeps waiting, then starts through the proxy', async () => {
    let status = 429;
    const v = await openVolunteer(URL_LIVE, () => (status === 429 ? { status } : { body: LIVE }));
    await v.page.waitForFunction(() => intervals.length > 0, null, { timeout: 5000 });
    await v.tick();
    assert.equal((await v.state()).status, 'waiting');
    assert.equal((await v.state()).fallback, false);
    status = 200;
    await v.tick();
    await v.page.waitForFunction(() => streamStates[0].status !== 'waiting', null, { timeout: 5000 });
    assert.ok(v.hls.some((r) => r.type === 'media'));
    await v.page.close();
  });

  for (const [status, why] of [[403, 'evideo blocks the proxy'], [410, 'proxy switched off'], [401, 'login cookie gone']]) {
    it(`${status} (${why}) falls back to direct playback instead of waiting forever`, async () => {
      const v = await openVolunteer(URL_LIVE, () => ({ status }));
      await v.page.waitForFunction(() => streamStates[0].fallback === true, null, { timeout: 8000 });
      await v.page.close();
    });
  }

  it('a master playlist variant with an absolute path is probed through the proxy', async () => {
    const master = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\n/pvr2026/chunks/low.m3u8\n';
    const v = await openVolunteer(URL_LIVE, (p) => (p.endsWith('index.m3u8') ? { body: master } : { body: EMPTY }));
    await v.page.waitForFunction(() => intervals.length > 0, null, { timeout: 5000 });
    await v.tick();
    await v.page.waitForFunction(() => document.querySelectorAll('.status-text').length > 0);
    assert.ok(v.hls.some((r) => /^\/hls\/live-0001\.evideo\.bg\/pvr2026\/chunks\/low\.m3u8$/.test(r.path)), JSON.stringify(v.hls));
    assert.equal((await v.state()).status, 'waiting');
    await v.page.close();
  });
});

// Bug of 25 Oct 2026: with no pre-assigned sections the volunteer gets 2 random streams, and the
// first heartbeat (60-90 s later) removed both cards because they were not in assigned_streams.
describe('Volunteer heartbeat keeps the cards it did not pre-assign', () => {
  async function loginAs(user) {
    const page = await browser.newPage();
    await page.route('**/*', (route) => {
      const u = new URL(route.request().url());
      if (u.hostname !== 'localhost') return route.abort();
      if (!u.pathname.startsWith('/hls/')) return route.continue();
      return route.fulfill({ status: 200, contentType: 'application/vnd.apple.mpegurl', body: EMPTY });
    });
    await page.goto(base + '/login');
    await page.fill('#username', user);
    await page.fill('#password', 'volpass123');
    await page.click('#submit-btn');
    await page.waitForURL(base + '/');
    await page.waitForFunction(() => intervals.length > 0, null, { timeout: 5000 });
    return page;
  }
  const newVolunteer = async () => {
    const user = `vol${++userSeq}`;
    assert.equal((await api('POST', '/api/users', { username: user, password: 'volpass123', role: 'volunteer' }, adminCookie)).status, 201);
    return user;
  };
  const cards = (page) => page.evaluate(() => ({
    states: streamStates.map((s) => s.id).sort(),
    dom: [...document.querySelectorAll('#stream-grid .stream-card')].map((c) => Number(c.dataset.streamId)).sort(),
  }));
  const serverUrls = (page) => page.evaluate(async () => {
    const res = await fetch('/api/heartbeat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session_id: SESSION_ID }) });
    return Object.keys((await res.json()).urls).map(Number).sort();
  });

  it('random streams survive heartbeats, on the page and on the server', async () => {
    // Only unassigned streams, as on the live site on 25 Oct
    const streams = [1, 2, 3, 4].map((i) => {
      const section = String(30000000 + i).padStart(9, '0');
      return { section, url: URL_LIVE.replace(SECTION, section), label: `random ${i}` };
    });
    assert.equal((await api('POST', '/api/streams', streams, adminCookie)).status, 200);
    const page = await loginAs(await newVolunteer());
    const before = await cards(page);
    assert.equal(before.states.length, 3, 'three streams by risk');
    assert.deepEqual(before.dom, before.states);

    await page.evaluate(() => sendHeartbeat());
    await page.evaluate(() => sendHeartbeat());
    await new Promise((r) => setTimeout(r, 200)); // let any DELETE the page sent reach the server
    assert.deepEqual(await cards(page), before, 'cards still on the page after heartbeats');
    assert.deepEqual(await serverUrls(page), before.states, 'assignments still on the server');
    await page.close();
  });

  it('a pre-assigned card still goes away once the admin unassigns it', async () => {
    const user = await newVolunteer();
    const section = String(40000000 + userSeq).padStart(9, '0');
    const stream = { section, url: URL_LIVE.replace(SECTION, section), label: user };
    await api('POST', '/api/streams/upsert', [{ ...stream, assigned_users: user }], adminCookie);

    const page = await loginAs(user);
    const own = await page.evaluate((sec) => streamStates.find((s) => s.stream.section === sec)?.id, section);
    assert.ok(own, 'own card shown');
    await api('POST', '/api/streams/upsert', [{ ...stream, assigned_users: '' }], adminCookie);
    await page.evaluate(() => sendHeartbeat());
    assert.ok(!(await cards(page)).dom.includes(own), 'own card gone');
    await new Promise((r) => setTimeout(r, 200));
    await page.evaluate(() => sendHeartbeat());
    assert.ok(!(await cards(page)).dom.includes(own), 'and not handed back');
    await page.close();
  });
});

// 1 Nov 2026 runoff: a test card for every volunteer (assigned_users '*') until counting starts,
// sections by risk from TOPUP_AFTER on open pages, and push to refresh after a deploy.
// Restarts the server, so it runs last.
describe('Test card, sections from TOPUP_AFTER and push to refresh', () => {
  const restart = async (env) => {
    await new Promise((resolve) => { child.once('exit', resolve); child.kill(); });
    await startServer(env);
  };
  const byId = (a, b) => a - b;
  const cardIds = (page) => page.evaluate(() => ({
    states: streamStates.map((s) => s.id),
    dom: [...document.querySelectorAll('#stream-grid .stream-card')].map((c) => Number(c.dataset.streamId)),
  })).then(({ states, dom }) => ({ states: states.sort(byId), dom: dom.sort(byId) }));

  it('an open page gets its sections at TOPUP_AFTER, drops a disabled test card, and reloads into the same session on a new release', async () => {
    const topupAt = Date.now() + 10_000;
    await restart({ RELEASE: 'e2e-a', TOPUP_AFTER: new Date(topupAt).toISOString() });
    const rows = [{ section: '999000001', url: 'https://archive.example.test/test.mp4', label: 'Test card', assigned_users: '*' }];
    for (let i = 1; i <= 4; i++) rows.push({ section: `08000000${i}`, url: '', label: `R${i}` });
    assert.equal((await api('POST', '/api/streams', rows, adminCookie)).status, 200);
    assert.equal((await api('POST', '/api/streams/risk', [1, 2, 3, 4].map((i) => ({ section: `08000000${i}`, risk: i })), adminCookie)).status, 200);
    const all = await (await fetch(base + '/api/streams', { headers: { Cookie: adminCookie } })).json();
    const id = Object.fromEntries(all.streams.map((s) => [s.label, s.id]));

    const user = `vol${++userSeq}`;
    assert.equal((await api('POST', '/api/users', { username: user, password: 'volpass123', role: 'volunteer' }, adminCookie)).status, 201);
    const page = await browser.newPage();
    await page.route('**/*', (route) => {
      const u = new URL(route.request().url());
      if (u.hostname !== 'localhost') return route.abort();
      if (!u.pathname.startsWith('/hls/')) return route.continue();
      return route.fulfill({ status: 200, contentType: 'application/vnd.apple.mpegurl', body: EMPTY });
    });
    await page.goto(base + '/login');
    await page.fill('#username', user);
    await page.fill('#password', 'volpass123');
    await page.click('#submit-btn');
    await page.waitForURL(base + '/');
    await page.waitForFunction(() => intervals.length > 0, null, { timeout: 5000 });

    // Before TOPUP_AFTER: the test card only
    assert.ok(Date.now() < topupAt, 'test ran too slowly: TOPUP_AFTER already passed');
    assert.deepEqual((await cardIds(page)).dom, [id['Test card']]);

    // After it, the next heartbeat adds the 3 highest-risk sections without a reload
    await new Promise((r) => setTimeout(r, Math.max(0, topupAt - Date.now() + 200)));
    await page.evaluate(() => { window.__notReloaded = true; });
    await page.evaluate(() => sendHeartbeat());
    const filled = [id['Test card'], id.R2, id.R3, id.R4].sort(byId);
    assert.deepEqual(await cardIds(page), { states: filled, dom: filled });

    // The operator disables the test card: the page drops it, keeps the 3 sections, gets no 4th
    assert.equal((await api('POST', '/api/streams/toggle', { id: id['Test card'], enabled: 0 }, adminCookie)).status, 200);
    await page.evaluate(() => sendHeartbeat());
    const three = [id.R2, id.R3, id.R4].sort(byId);
    assert.deepEqual(await cardIds(page), { states: three, dom: three });
    const sessionId = await page.evaluate(() => SESSION_ID);

    // A deploy: the server now reports another release. With the section picker open the page only
    // shows the banner; once it closes, the page reloads by itself into the same session.
    await restart({ RELEASE: 'e2e-b' });
    assert.equal(await page.evaluate(() => document.getElementById('release-banner').hidden), true);
    await page.click('#add-section-btn');
    await page.evaluate(() => sendHeartbeat());
    await page.waitForFunction(() => !document.getElementById('release-banner').hidden, null, { timeout: 5000 });
    assert.equal(
      await page.evaluate(() => document.querySelector('#release-banner span').textContent),
      await page.evaluate(() => t('release.new')),
    );
    assert.ok(await page.evaluate(() => document.getElementById('release-reload').offsetHeight > 0), 'reload button visible');
    await new Promise((r) => setTimeout(r, 2500));
    assert.equal(await page.evaluate(() => window.__notReloaded), true, 'no reload while the picker is open');

    await page.click('#section-modal-close');
    await page.waitForFunction(() => window.__notReloaded === undefined && typeof intervals !== 'undefined' && intervals.length > 0,
      null, { timeout: 10_000 });
    assert.equal(await page.evaluate(() => SESSION_ID), sessionId, 'same session after the reload');
    assert.equal(await page.evaluate(() => window.RELEASE), 'e2e-b');
    assert.deepEqual(await cardIds(page), { states: three, dom: three }, 'same cards after the reload');
    await page.evaluate(() => sendHeartbeat());
    assert.equal(await page.evaluate(() => document.getElementById('release-banner').hidden), true, 'no banner for the release it runs');
    await page.close();
  });
});
