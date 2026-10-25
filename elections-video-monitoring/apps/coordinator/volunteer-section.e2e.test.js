'use strict';

// Volunteer page in Chromium: each card shows its section number with a copy button, and the
// inspect view's "Подай сигнал" link prefills the Tally form with the login email and section.
// Every non-localhost request is aborted and /hls/ is answered in the browser, so nothing
// reaches evideo or tally. Needs Playwright's Chromium: node --test volunteer-section.e2e.test.js

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { chromium } = require('@playwright/test');

const EMPTY = '#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXT-X-MEDIA-SEQUENCE:0\n';

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
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start:\n${stderr}`)), 10_000);
    child.stdout.on('data', (d) => { if (d.toString().includes('Election monitor')) { clearTimeout(timer); resolve(); } });
  });
  adminCookie = (await api('POST', '/api/login', { username: 'admin', password: 'adminpass123' })).cookie;
  browser = await chromium.launch();
});

after(async () => {
  if (browser) await browser.close();
  if (child) child.kill();
});

let seq = 0;

// Logs in a fresh volunteer (`user`) with one assigned stream; returns the page and its section
async function openVolunteer(user, contextOptions = {}) {
  seq++;
  assert.equal((await api('POST', '/api/users', { username: user, password: 'volpass123', role: 'volunteer' }, adminCookie)).status, 201);
  const section = String(30000000 + seq).padStart(9, '0');
  const url = `https://live-0001.evideo.bg/pvr2026/${section}/index.m3u8`;
  await api('POST', '/api/streams/upsert', [{ section, url, label: `Test ${seq}`, assigned_users: user }], adminCookie);

  const context = await browser.newContext(contextOptions);
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
  const page = await context.newPage();
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
  await page.waitForFunction(() => streamStates.length === 1);
  return { page, context, section };
}

// Opens the inspect view and returns the "Подай сигнал" href once the page has prefilled it
async function reportHref(page) {
  await page.click('.stream-card .card-label');
  const handle = await page.waitForSelector('#inspect-frame');
  const inner = await handle.contentFrame();
  await inner.waitForFunction(() => document.getElementById('btn-signal-video').href.includes('?'), null, { timeout: 8000 });
  return inner.evaluate(() => document.getElementById('btn-signal-video').href);
}

describe('Section number on the volunteer card and the prefilled report form', () => {
  it('shows the section, copies it with one tap, and prefills email and section in the Tally link', async () => {
    const v = await openVolunteer('volunteer.one@example.org');
    const num = v.page.locator('.stream-card .card-section-num');
    assert.equal((await num.textContent()).trim(), v.section);

    await v.page.click('.stream-card .card-copy');
    assert.equal(await v.page.evaluate(() => navigator.clipboard.readText()), v.section);
    await v.page.waitForSelector('.card-section.copied');
    assert.equal((await v.page.locator('.card-copied').textContent()).trim(), 'Копирано');
    // Copying or selecting the number does not open the inspect view
    await num.click();
    assert.equal(await v.page.locator('.stream-card.selected').count(), 0);

    const href = new URL(await reportHref(v.page));
    assert.equal(href.origin + href.pathname, 'https://tally.so/r/labENX');
    assert.equal(href.searchParams.get('email'), 'volunteer.one@example.org');
    assert.equal(href.searchParams.get('volunteer'), 'volunteer.one@example.org');
    assert.equal(href.searchParams.get('section'), v.section);
    await v.context.close();
  });

  it('leaves a non-email username out of the email question but still sends it and the section', async () => {
    const v = await openVolunteer('vol' + 'x'.repeat(9));
    const href = new URL(await reportHref(v.page));
    assert.equal(href.searchParams.get('email'), null);
    assert.equal(href.searchParams.get('volunteer'), 'vol' + 'x'.repeat(9));
    assert.equal(href.searchParams.get('section'), v.section);
    await v.context.close();
  });

  it('on a 320px touch screen the copy button is 44px tall, the number stays on one line, and the page does not scroll sideways', async () => {
    const v = await openVolunteer('volunteer.two@example.org', { viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true });
    const box = await v.page.locator('.stream-card .card-copy').boundingBox();
    assert.ok(box.height >= 44 && box.width >= 36, JSON.stringify(box));
    const numBox = await v.page.locator('.stream-card .card-section-num').boundingBox();
    const cardBox = await v.page.locator('.stream-card').boundingBox();
    assert.ok(numBox.x + numBox.width <= box.x + 0.5, 'number and button do not overlap');
    assert.ok(numBox.height < 24, `number wraps: ${JSON.stringify(numBox)}`);
    const numEl = v.page.locator('.stream-card .card-section-num');
    assert.equal(await numEl.evaluate((el) => el.scrollWidth <= el.clientWidth), true, 'number is not clipped');
    assert.ok(box.x + box.width <= cardBox.x + cardBox.width, 'button stays inside the card');
    assert.equal(await v.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    if (process.env.SCREENSHOT_DIR) await v.page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, 'volunteer-section-320.png') });
    await v.context.close();
  });

  it('"Добави секция" lists the highest risk first with a badge, and fits a 320px screen', async () => {
    await api('POST', '/api/streams/upsert', [
      { section: '040000001', url: 'https://live-0001.evideo.bg/pvr2026/040000001/index.m3u8', label: 'Риск нисък, дълъг адрес на секцията ул. „Някоя“ № 123' },
      { section: '040000002', url: 'https://live-0001.evideo.bg/pvr2026/040000002/index.m3u8', label: 'Риск висок' },
    ], adminCookie);
    await api('POST', '/api/streams/risk', [{ section: '040000001', risk: 3 }, { section: '040000002', risk: 17 }], adminCookie);
    const v = await openVolunteer('volunteer.three@example.org', { viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true });
    await v.page.click('#add-section-btn');
    await v.page.waitForSelector('#section-list .section-item');
    const first = v.page.locator('#section-list .section-item').first();
    assert.equal(await first.locator('.section-id').textContent(), '040000002');
    assert.match(await first.locator('.section-risk').textContent(), /17/);
    const badge = await first.locator('.section-risk').boundingBox();
    const item = await first.boundingBox();
    assert.ok(badge.x + badge.width <= item.x + item.width + 0.5, 'badge stays inside the row');
    assert.equal(await v.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    if (process.env.SCREENSHOT_DIR) await v.page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, 'section-picker-risk-320.png') });
    await v.context.close();
  });
});
