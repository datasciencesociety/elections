'use strict';

// /inspect/ in Chromium: what the status says when playback fails.
// - evideo answers 404 or an empty playlist through /hls → "Излъчването не е започнало", no retry count
// - /hls fails but the stream plays straight from evideo → "our platform" message + direct link
// - both fail → the old retry message
// Every /hls/ and evideo request is answered inside the browser; nothing reaches evideo.
// Needs Playwright's Chromium and ffmpeg (for a tiny WebM): node --test inspect-diagnosis.e2e.test.js

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { chromium } = require('@playwright/test');

const EMPTY = '#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXT-X-MEDIA-SEQUENCE:0\n';
const URL_LIVE = 'https://live-0001.evideo.bg/pvr2026/010100001/index.m3u8';
const URL_MP4 = 'https://archive.evideo.bg/pvr2026/010100001/rec.mp4';

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
    srv.on('error', reject);
  });
}

let child, browser, base, cookie, webm;

before(async () => {
  const port = await freePort();
  base = `http://localhost:${port}`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'inspect-e2e-'));
  webm = path.join(tmp, 'clip.webm');
  execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=64x36:rate=5', '-t', '2',
    '-c:v', 'libvpx', '-b:v', '50k', webm]);
  child = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    env: { ...process.env, PORT: String(port), DB_PATH: path.join(tmp, 'e2e.db'), ADMIN_USER: 'admin', ADMIN_PASS: 'adminpass123', COOKIE_SECRET: 'e2e', PROXY_URL: '/hls' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start')), 10_000);
    child.stdout.on('data', (d) => { if (d.toString().includes('Election monitor')) { clearTimeout(timer); resolve(); } });
  });
  const res = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'adminpass123' }) });
  cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  browser = await chromium.launch();
});

after(async () => {
  if (browser) await browser.close();
  if (child) child.kill();
});

// hls(path) answers /hls/ requests; direct(url) answers requests to evideo hosts (null aborts)
async function openInspect(streamUrl, { hls, direct = () => null }) {
  const context = await browser.newContext({ locale: 'bg-BG' });
  const [name, value] = cookie.split('=');
  await context.addCookies([{ name, value, url: base }]);
  const page = await context.newPage();
  const seen = { hls: 0, direct: 0 };
  await page.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === 'localhost' && u.pathname.startsWith('/hls/')) { seen.hls++; return route.fulfill(hls(u.pathname)); }
    if (u.hostname === 'localhost') return route.continue();
    if (u.hostname.endsWith('.evideo.bg')) { seen.direct++; const r = direct(u.href); return r ? route.fulfill(r) : route.abort(); }
    return route.abort();
  });
  await page.goto(`${base}/inspect/?url=${encodeURIComponent(streamUrl)}`);
  return { page, context, seen };
}

const statusText = (page) => page.locator('#status-text');

describe('inspect: why playback failed', { timeout: 90_000 }, () => {
  it('404 from evideo through /hls: not started, no retry count', async () => {
    const { page, context } = await openInspect(URL_LIVE, { hls: () => ({ status: 404, body: '' }) });
    await assert.doesNotReject(statusText(page).filter({ hasText: 'Излъчването не е започнало' }).waitFor({ timeout: 20_000 }));
    assert.doesNotMatch(await page.locator('#status-sub').textContent(), /HLS|networkError|manifest/);
    assert.doesNotMatch(await page.locator('#alert-log').textContent(), /Фатална HLS/);
    await context.close();
  });

  it('empty playlist through /hls: not started', async () => {
    const { page, context } = await openInspect(URL_LIVE, {
      hls: () => ({ status: 200, contentType: 'application/vnd.apple.mpegurl', body: EMPTY }),
    });
    await assert.doesNotReject(statusText(page).filter({ hasText: 'Излъчването не е започнало' }).waitFor({ timeout: 20_000 }));
    await context.close();
  });

  it('/hls fails, evideo plays directly: our platform, with a link to evideo', async () => {
    const { page, context, seen } = await openInspect(URL_MP4, {
      hls: () => ({ status: 502, body: '' }),
      direct: () => ({ status: 200, contentType: 'video/webm', body: fs.readFileSync(webm) }),
    });
    await assert.doesNotReject(statusText(page).filter({ hasText: 'Нашата платформа' }).waitFor({ timeout: 25_000 }));
    const link = page.locator('#status-sub a.status-link');
    assert.equal(await link.getAttribute('href'), URL_MP4);
    assert.equal(await link.getAttribute('target'), '_blank');
    assert.ok(seen.direct >= 1, 'the direct check went to the (faked) evideo host');
    assert.match(await page.locator('#btn-open-url').getAttribute('class'), /attention/);
    await context.close();
  });

  it('/hls fails and evideo fails too: the retry message as before', async () => {
    const { page, context } = await openInspect(URL_MP4, { hls: () => ({ status: 502, body: '' }) });
    await assert.doesNotReject(statusText(page).filter({ hasText: 'повторен опит' }).waitFor({ timeout: 25_000 }));
    await context.close();
  });
});
