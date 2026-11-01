'use strict';

// Two volunteer pages in Chromium watch the same section; the ended state is shared through the
// server. Page A sees the playlist empty from 21:07 and ends the card at 21:22 ("Не излъчва от 21:07");
// page B, whose own 15 minutes have not run out, shows the same on its next heartbeat. Segments come
// back: B revives the card, the server clears the state and A follows on its heartbeat.
// The pages' Date.now() is faked (page.clock.setFixedTime); the server runs with its clock moved to
// 21:25 Sofia on 1 Nov 2026 (a -r preload, test only), so its ENDED_AFTER default (21:00) and the
// stop-time check see the same evening. Every /hls/ request is answered inside the browser and every
// non-localhost request is aborted, so nothing reaches evideo.
// Needs Playwright's Chromium: node --test volunteer-ended-shared.e2e.test.js

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
  env.ENDED_MIN_VOTERS = '1'; // one page's end is shared at once here; ended-votes.test.js covers the 2-volunteer rule
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

describe('Ended state shared between pages', () => {
  it('A ends the card after 15 empty minutes; B shows it ended on its next heartbeat; B revives it and A follows', async () => {
    body = LIVE;
    const a = await openVolunteer('vola', sofia('21:05'));
    const b = await openVolunteer('volb', sofia('21:05'));
    const id = await a.page.evaluate(() => streamStates[0].id);
    assert.equal(await b.page.evaluate(() => streamStates[0].id), id, 'both watch the same section');

    body = EMPTY_BODY;
    await a.probeAt(sofia('21:07'));
    await b.probeAt(sofia('21:08'));
    await a.probeAt(sofia('21:21', '59'));
    assert.notEqual((await a.state()).status, 'ended');
    await a.probeAt(sofia('21:22'));
    assert.equal((await a.state()).status, 'ended');
    assert.equal((await a.state()).text, 'Не излъчва от 21:07', 'when the playlist went empty, not when the card ended');
    await a.settled();
    assert.deepEqual(a.reports.flatMap((r) => r.results).filter((r) => r.status === 'ended'),
      [{ stream_id: id, status: 'ended', stopped_at: sofia('21:07').getTime() }]);

    // B's own timer: 14 min. Before 21:00 on its clock the server's word counts for nothing
    await b.heartbeatAt(sofia('20:59'));
    assert.notEqual((await b.state()).status, 'ended', 'never ended before ENDED_AFTER');
    await b.heartbeatAt(sofia('21:22'));
    const sb = await b.state();
    assert.equal(sb.status, 'ended', 'ended from the server, without its own 15 min');
    assert.equal(sb.text, 'Не излъчва от 21:07', 'the same time as page A');
    assert.equal(sb.src, null, 'video stopped');
    for (const [w, h] of [[320, 568], [1280, 800]]) {
      await b.page.setViewportSize({ width: w, height: h });
      const fit = await b.page.evaluate(() => {
        const el = streamStates[0].card.querySelector('.status-text');
        return { page: document.documentElement.scrollWidth, vw: innerWidth, clipped: el.scrollWidth > el.clientWidth };
      });
      assert.ok(fit.page <= fit.vw, `no horizontal scroll at ${w}x${h}`);
      assert.equal(fit.clipped, false, `the text wraps instead of being cut at ${w}x${h}`);
    }
    await b.page.evaluate(() => setLang('en'));
    assert.equal((await b.state()).text, 'Not broadcasting since 21:07');
    await b.page.evaluate(() => setLang('bg'));
    b.reports.length = 0;
    await b.page.evaluate(() => sendReport());
    assert.deepEqual(b.reports[0].results, [], 'B sends no reports for it, and no ended of its own');

    await a.heartbeatAt(sofia('21:23')); // A learns that the server has its end

    // Segments again: B's 2-min recheck revives the card and tells the server
    body = LIVE;
    await b.probeAt(sofia('21:23'));
    assert.equal((await b.state()).status, 'ended', 'no recheck within 2 min');
    await b.probeAt(sofia('21:24'));
    const sb2 = await b.state();
    assert.notEqual(sb2.status, 'ended');
    assert.match(sb2.src || '', /^\/hls\//, 'B plays again');
    await b.settled();
    assert.ok(b.reports.flatMap((r) => r.results).some((r) => r.stream_id === id && r.status === 'live'), "B sent 'live'");

    // A follows on its next heartbeat, before its own recheck
    await a.heartbeatAt(sofia('21:23', '30'));
    await a.page.waitForFunction(() => streamStates[0].status !== 'ended' && !streamStates[0].endProbing); // checks the playlist first
    const sa = await a.state();
    assert.notEqual(sa.status, 'ended', 'A follows the server');
    assert.match(sa.src || '', /^\/hls\//, 'A plays again');
    assert.doesNotMatch(sa.text, /Не излъчва/);
    // B's next heartbeat does not end it again
    await b.heartbeatAt(sofia('21:25'));
    assert.notEqual((await b.state()).status, 'ended');
    assert.deepEqual([...a.errors, ...b.errors], []);
    await a.page.close();
    await b.page.close();
  });

  it('the server stops listing the card while its playlist is still empty: the card stays ended, never direct playback', async () => {
    body = LIVE;
    const a = await openVolunteer('vola', sofia('21:28'));
    const b = await openVolunteer('volb', sofia('21:28'));
    body = EMPTY_BODY;
    await a.probeAt(sofia('21:30'));
    await a.probeAt(sofia('21:45'));
    assert.equal((await a.state()).status, 'ended');
    await a.settled();
    await a.heartbeatAt(sofia('21:45', '30')); // A learns that the server has its end
    // A stray 'live' from B while the playlist is still empty clears the server's mark
    await b.page.evaluate(() => reportTransition(streamStates[0], 'live'));
    await b.settled();
    await a.heartbeatAt(sofia('21:46'));
    await a.page.waitForFunction(() => !streamStates[0].endProbing);
    const sa = await a.state();
    assert.equal(sa.status, 'ended', 'an empty playlist keeps the card ended');
    assert.equal(sa.src, null, 'no video started on an empty playlist');
    assert.equal(await a.page.evaluate(() => !!streamStates[0].fallback), false, 'not in direct playback');
    // Segments really return: the 2-min recheck plays it again
    body = LIVE;
    await a.probeAt(sofia('21:48', '30'));
    const sa2 = await a.state();
    assert.notEqual(sa2.status, 'ended');
    assert.match(sa2.src || '', /^\/hls\//, 'plays again once segments are back');
    assert.deepEqual([...a.errors, ...b.errors], []);
    await a.page.close();
    await b.page.close();
  });

  it('a page from the previous release ignores the ended list', async (t) => {
    let oldHtml;
    try {
      oldHtml = execFileSync('git', ['show', '0b1068d:./public/volunteer.html'], { cwd: __dirname, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    } catch { t.skip('release 0b1068d not in this checkout'); return; }
    assert.ok(!oldHtml.includes('applyServerEnded'), 'the old page');

    body = LIVE;
    const a = await openVolunteer('vola', sofia('21:30'));
    const old = await openVolunteer('volold', sofia('21:30'), oldHtml);
    assert.equal(await old.page.evaluate(() => typeof applyServerEnded), 'undefined', 'the old page is served');
    body = EMPTY_BODY;
    await a.probeAt(sofia('21:31'));
    await a.probeAt(sofia('21:46'));
    assert.equal((await a.state()).status, 'ended');
    await a.settled();

    // The server now lists the section as ended in every heartbeat
    let heartbeat;
    old.page.on('response', async (r) => { if (r.url().endsWith('/api/heartbeat')) heartbeat = await r.json(); });
    await old.heartbeatAt(sofia('21:47'));
    await new Promise((r) => setTimeout(r, 200));
    assert.ok(heartbeat && heartbeat.ended && Object.keys(heartbeat.ended).length === 1, 'the old page got an ended list');
    const s = await old.state();
    assert.equal(s.online, true, 'the heartbeat was handled without error');
    assert.equal(s.cards, 1, 'the card stays');
    assert.notEqual(s.status, 'ended', 'the old page keeps its own detection');
    assert.deepEqual(old.errors, []);
    await a.page.close();
    await old.page.close();
  });
});
