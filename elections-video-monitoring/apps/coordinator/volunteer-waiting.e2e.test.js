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

let child, browser, base, adminCookie;

async function api(method, urlPath, body, cookie) {
  const res = await fetch(base + urlPath, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
}

before(async () => {
  const port = await freePort();
  base = `http://localhost:${port}`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'coord-e2e-'));
  child = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    env: { ...process.env, PORT: String(port), DB_PATH: path.join(tmp, 'e2e.db'), ADMIN_USER: 'admin', ADMIN_PASS: 'adminpass123', COOKIE_SECRET: 'e2e', PROXY_URL: '/hls' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start')), 10_000);
    child.stdout.on('data', (d) => { if (d.toString().includes('Election monitor')) { clearTimeout(timer); resolve(); } });
  });
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
  await page.waitForFunction(() => streamStates.length === 1);
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
