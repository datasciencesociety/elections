'use strict';

// Volunteer page in Chromium: a card whose stream played and then stopped after the count
// shows "Излъчването приключи – БЛАГОДАРИМ ВИ!". evideo never sends #EXT-X-ENDLIST; an ended
// stream answers 200 with an empty playlist. Date.now() is faked (page.clock.setFixedTime) and the
// probes are called directly, so each step is deterministic.
// Every /hls/ request is answered inside the browser and every non-localhost request is aborted,
// so nothing reaches evideo. Needs Playwright's Chromium: node --test volunteer-ended.e2e.test.js

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { chromium } = require('@playwright/test');

const EMPTY_BODY = '';
const EMPTY = '#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXT-X-MEDIA-SEQUENCE:0\n';
const LIVE = '#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXT-X-MEDIA-SEQUENCE:1\n#EXTINF:4.0,\nseg1.ts\n';
const SECTION = '010100001';
const URL_LIVE = `https://live-0001.evideo.bg/pvr2026/${SECTION}/index.m3u8`;
// 1 Nov 2026 is winter time in Sofia (UTC+2)
const sofia = (hhmm, ss = '00') => new Date(`2026-11-01T${hhmm}:${ss}+02:00`);
const ENDED_BG = /^Не излъчва от \d\d:\d\d$/;

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
  return { status: res.status, cookie: (res.headers.get('set-cookie') || '').split(';')[0], text: await res.text() };
}

before(async () => {
  const port = await freePort();
  base = `http://localhost:${port}`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'coord-e2e-'));
  const env = { ...process.env, PORT: String(port), DB_PATH: path.join(tmp, 'e2e.db'), ADMIN_USER: 'admin', ADMIN_PASS: 'adminpass123', COOKIE_SECRET: 'e2e', PROXY_URL: '/hls' };
  delete env.ENDED_AFTER; // the default (21:00 Sofia) is what these tests check
  child = spawn(process.execPath, [path.join(__dirname, 'server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
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

let userSeq = 0;

// A volunteer with one assigned stream, opened at Sofia time `at`; `answer(path)` decides each
// playlist fetch. The <video>'s own requests are recorded and left pending, so the card never
// errors into direct playback (which would bypass the proxy).
async function openVolunteer(at, answer, streamUrl = URL_LIVE) {
  const user = `vol${++userSeq}`;
  assert.equal((await api('POST', '/api/users', { username: user, password: 'volpass123', role: 'volunteer' }, adminCookie)).status, 201);
  const section = String(50000000 + userSeq).padStart(9, '0');
  await api('POST', '/api/streams/upsert', [{ section, url: streamUrl.replace(SECTION, section), label: user, assigned_users: user }], adminCookie);

  const page = await browser.newPage();
  await page.clock.setFixedTime(at);
  const hls = [];
  const reports = [];
  await page.route('**/*', (route) => {
    const req = route.request();
    const u = new URL(req.url());
    if (u.hostname !== 'localhost') return route.abort();
    if (u.pathname === '/api/report') { reports.push(req.postDataJSON()); return route.continue(); }
    if (!u.pathname.startsWith('/hls/')) return route.continue();
    hls.push({ path: u.pathname, type: req.resourceType() });
    if (req.resourceType() === 'media') return undefined; // left pending on purpose
    const { status = 200, body = '' } = answer(u.pathname);
    return route.fulfill({ status, contentType: 'application/vnd.apple.mpegurl', body });
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
      status: s.status, fallback: s.fallback, hadSegments: !!s.hadSegments, emptySince: s.emptySince || null,
      src: s.video ? s.video.getAttribute('src') : null,
      text: s.card.querySelector('.status-text').textContent,
      onPage: document.body.contains(s.card),
    };
  });
  // One ended-probe at Sofia time `t`
  const probeAt = async (t) => {
    await page.clock.setFixedTime(t);
    await page.evaluate(async () => {
      while (streamStates[0].endProbing) await new Promise((r) => setTimeout(r, 20));
      await probeEnded(streamStates[0]);
    });
  };
  const fetches = () => hls.filter((r) => r.type === 'fetch').length;
  // Every periodic check the page runs, then a moment for any request they start
  const runChecks = async () => {
    await page.evaluate(() => { checkEndedAll(); checkAllStreams(); });
    await new Promise((r) => setTimeout(r, 300));
  };
  return { page, hls, reports, state, probeAt, fetches, runChecks };
}

describe('Volunteer card for a stream that has ended', () => {
  it('(a) before 21:00 an empty playlist after segments does not end the card, and no probe runs before 20:45', async () => {
    let body = LIVE;
    const v = await openVolunteer(sofia('20:30'), () => ({ body }));
    assert.equal((await v.state()).hadSegments, true);
    assert.notEqual((await v.state()).status, 'waiting');
    body = EMPTY_BODY;

    const before = v.fetches();
    await v.page.clock.setFixedTime(sofia('20:44'));
    await v.runChecks();
    assert.equal(v.fetches(), before, 'no ended probe before 21:00 - 15 min');

    await v.probeAt(sofia('20:46'));
    assert.equal(v.fetches(), before + 1, 'probing starts at 20:45');
    await v.probeAt(sofia('20:50'));
    await v.probeAt(sofia('20:59'));
    await v.probeAt(sofia('21:00'));
    const s = await v.state();
    assert.notEqual(s.status, 'ended', '14 min empty, even past 21:00');
    assert.equal(s.emptySince, sofia('20:46').getTime());
    assert.equal(s.fallback, false);
    await v.page.close();
  });

  it('(a) 20 min of empty playlists at 20:50 still do not end the card; it ends at 21:00', async () => {
    let body = LIVE;
    const v = await openVolunteer(sofia('20:20'), () => ({ body }));
    body = EMPTY_BODY;
    await v.probeAt(sofia('20:30')); // called directly: the page itself does not probe this early
    await v.probeAt(sofia('20:50'));
    assert.notEqual((await v.state()).status, 'ended', 'never before 21:00');
    await v.probeAt(sofia('21:00'));
    assert.equal((await v.state()).status, 'ended');
    await v.page.close();
  });

  it('(b) after 21:00, 15 min of empty playlists end the card: thank-you text, video and probing stopped, no reports', async () => {
    let body = LIVE;
    const v = await openVolunteer(sofia('21:05'), () => ({ body }));
    body = EMPTY_BODY;
    await v.probeAt(sofia('21:06'));
    await v.probeAt(sofia('21:15'));
    await v.probeAt(sofia('21:20', '59'));
    assert.notEqual((await v.state()).status, 'ended', '14:59 is not enough');
    await v.probeAt(sofia('21:21'));
    const s = await v.state();
    assert.equal(s.status, 'ended');
    assert.equal(s.text, 'Не излъчва от 21:06', 'the time the playlist went empty, not when the card ended');
    assert.equal(s.src, null, 'video stopped');
    assert.equal(s.onPage, true, 'the card stays on the page');
    assert.equal(s.fallback, false, 'stopping the video does not switch to direct playback');
    for (const [w, h] of [[320, 568], [568, 320], [1280, 800]]) {
      await v.page.setViewportSize({ width: w, height: h });
      const fit = await v.page.evaluate(() => {
        const el = streamStates[0].card.querySelector('.status-text');
        return { page: document.documentElement.scrollWidth, vw: innerWidth, clipped: el.scrollWidth > el.clientWidth };
      });
      assert.ok(fit.page <= fit.vw, `no horizontal scroll at ${w}x${h}`);
      assert.equal(fit.clipped, false, `the thank-you text wraps instead of being cut at ${w}x${h}`);
    }

    // Detection stops; the playlist is rechecked only every 2 min, and stays ended while empty
    const after = v.hls.length;
    await v.page.clock.setFixedTime(sofia('21:22'));
    await v.runChecks();
    await v.probeAt(sofia('21:22', '59'));
    assert.equal(v.hls.length, after, 'no request within 2 min of ending');
    await v.probeAt(sofia('21:23'));
    assert.equal(v.hls.length, after + 1, 'one recheck after 2 min');
    await v.probeAt(sofia('21:24'));
    assert.equal(v.hls.length, after + 1, 'and the next only 2 min later');
    assert.equal((await v.state()).status, 'ended');
    assert.equal((await v.state()).src, null);

    await v.page.waitForFunction(() => !streamStates[0].transition); // the change to ended has been sent
    v.reports.length = 0;
    await v.page.evaluate(() => sendReport());
    assert.equal(v.reports.length, 1);
    assert.deepEqual(v.reports[0].results, [], 'an ended card sends no frozen/dark reports');

    await v.page.evaluate(() => setLang('en'));
    assert.equal((await v.state()).text, 'Not broadcasting since 21:06');
    await v.page.evaluate(() => setLang('bg'));
    await v.page.close();
  });

  it('(c) a segment at minute 10 keeps the card live and restarts the 15 minutes', async () => {
    let body = LIVE;
    const v = await openVolunteer(sofia('21:05'), () => ({ body }));
    body = EMPTY;
    await v.probeAt(sofia('21:06'));
    body = LIVE;
    await v.probeAt(sofia('21:16'));
    assert.equal((await v.state()).emptySince, null, 'timer reset');
    body = EMPTY;
    await v.probeAt(sofia('21:17'));
    await v.probeAt(sofia('21:31'));
    assert.notEqual((await v.state()).status, 'ended', '25 min since the first empty, 14 since the segment');
    await v.probeAt(sofia('21:32'));
    assert.equal((await v.state()).status, 'ended');
    await v.page.close();
  });

  it('ended is not final: a segment after the end plays the card again and reports resume', async () => {
    let body = LIVE;
    const v = await openVolunteer(sofia('20:55'), () => ({ body }));
    body = EMPTY_BODY;
    await v.probeAt(sofia('21:00'));
    await v.probeAt(sofia('21:15'));
    assert.equal((await v.state()).status, 'ended');
    await v.page.waitForFunction(() => !streamStates[0].transition); // the change to ended has been sent
    const id = await v.page.evaluate(() => streamStates[0].id);
    assert.deepEqual(v.reports.flatMap((r) => r.results).filter((r) => r.status === 'ended'),
      [{ stream_id: id, status: 'ended', stopped_at: sofia('21:00').getTime() }], 'the change to ended is sent once, with the stop time');
    v.reports.length = 0;
    await v.page.evaluate(() => sendReport());
    assert.deepEqual(v.reports[0].results, [], 'no reports while ended');

    body = LIVE;
    const mediaBefore = v.hls.filter((r) => r.type === 'media').length;
    await v.probeAt(sofia('21:20'));
    const s = await v.state();
    assert.notEqual(s.status, 'ended');
    assert.equal(s.emptySince, null);
    assert.match(s.src || '', /^\/hls\/live-0001\.evideo\.bg\/pvr2026\/\d+\/index\.m3u8$/, 'video source set again');
    assert.doesNotMatch(s.text, ENDED_BG);
    await new Promise((r) => setTimeout(r, 300));
    assert.ok(v.hls.filter((r) => r.type === 'media').length > mediaBefore, 'the video requests the playlist again');

    await v.page.evaluate(() => checkAllStreams()); // detection runs again
    assert.equal((await v.state()).status, 'loading');
    await v.page.waitForFunction(() => !streamStates[0].transition); // the change to live has been sent
    assert.ok(v.reports.flatMap((r) => r.results).some((r) => r.stream_id === id && r.status === 'live'), "'live' sent on resume");
    v.reports.length = 0;
    await v.page.evaluate(() => sendReport());
    assert.equal(v.reports[0].results.length, 1, 'reports resume');
    assert.equal(v.reports[0].results[0].status, 'loading');

    // And it can end again: a fresh 15 min of empty playlists
    body = EMPTY_BODY;
    await v.probeAt(sofia('21:21'));
    await v.probeAt(sofia('21:35'));
    assert.notEqual((await v.state()).status, 'ended');
    await v.probeAt(sofia('21:36'));
    assert.equal((await v.state()).status, 'ended');
    await v.page.close();
  });

  it('(d) a card that never had segments stays "not started"', async () => {
    const v = await openVolunteer(sofia('21:05'), () => ({ body: EMPTY_BODY }));
    for (const t of ['21:06', '21:30', '22:00', '23:30']) {
      await v.probeAt(sofia(t));
      await v.runChecks();
    }
    const s = await v.state();
    assert.equal(s.status, 'waiting');
    assert.equal(s.hadSegments, false);
    assert.equal(s.text, 'Излъчването не е започнало');
    await v.page.close();
  });

  it('errors (429, 5xx, 403) neither start nor reset the timer', async () => {
    let answer = { body: LIVE };
    const v = await openVolunteer(sofia('21:05'), () => answer);
    answer = { status: 503 };
    await v.probeAt(sofia('21:06'));
    assert.equal((await v.state()).emptySince, null, 'an error does not start the timer');
    answer = { body: EMPTY_BODY };
    await v.probeAt(sofia('21:10'));
    for (const status of [429, 502, 403]) {
      answer = { status };
      await v.probeAt(sofia('21:15'));
    }
    assert.equal((await v.state()).emptySince, sofia('21:10').getTime(), 'errors do not reset it');
    answer = { body: EMPTY_BODY };
    await v.probeAt(sofia('21:25'));
    assert.equal((await v.state()).status, 'ended');
    await v.page.close();
  });

  it('a master playlist: ended only when the variant is empty too', async () => {
    const master = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\nmain_stream.m3u8\n';
    let index = master, variant = LIVE;
    const v = await openVolunteer(sofia('21:05'), (p) => ({ body: p.endsWith('/index.m3u8') ? index : variant }));
    assert.equal((await v.state()).hadSegments, true);
    // evideo empties the master first: the variant we know still lists segments → live
    index = EMPTY_BODY;
    await v.probeAt(sofia('21:06'));
    await v.probeAt(sofia('21:30'));
    assert.equal((await v.state()).emptySince, null);
    assert.ok(v.hls.some((r) => /\/hls\/live-0001\.evideo\.bg\/pvr2026\/\d+\/main_stream\.m3u8$/.test(r.path)), 'variant read through the proxy');
    variant = EMPTY_BODY;
    await v.probeAt(sofia('21:31'));
    await v.probeAt(sofia('21:46'));
    assert.equal((await v.state()).status, 'ended');
    await v.page.close();
  });
});

describe('ENDED_AFTER', () => {
  it('the server injects it next to PROXY_BASE, empty when unset', async () => {
    const user = `vol${++userSeq}`;
    await api('POST', '/api/users', { username: user, password: 'volpass123', role: 'volunteer' }, adminCookie);
    const cookie = (await api('POST', '/api/login', { username: user, password: 'volpass123' })).cookie;
    const html = (await api('GET', '/', undefined, cookie)).text;
    assert.match(html, /window\.PROXY_BASE = "\/hls";.*window\.ENDED_AFTER = "";/);
  });

  it('the page reads an ISO time, HH:MM in Sofia, or defaults to 21:00 Sofia', async () => {
    const v = await openVolunteer(sofia('10:00'), () => ({ body: EMPTY }));
    const cases = [
      ['', '2026-11-01T10:00:00Z', '2026-11-01T19:00:00.000Z'],
      ['', '2026-11-01T23:30:00Z', '2026-11-01T19:00:00.000Z'], // 01:30 Sofia on 2 Nov: still the night of 1 Nov
      ['', '2026-07-01T10:00:00Z', '2026-07-01T18:00:00.000Z'], // summer time
      ['', '2026-10-25T08:00:00Z', '2026-10-25T19:00:00.000Z'], // the day clocks went back
      ['22:30', '2026-11-01T10:00:00Z', '2026-11-01T20:30:00.000Z'],
      ['2026-11-01T20:00:00+02:00', '2026-11-01T10:00:00Z', '2026-11-01T18:00:00.000Z'],
      ['not a time', '2026-11-01T10:00:00Z', '2026-11-01T19:00:00.000Z'],
    ];
    const got = await v.page.evaluate((cases) => cases.map(([cfg, now]) => {
      window.ENDED_AFTER = cfg;
      return new Date(endedAfterMs(Date.parse(now))).toISOString();
    }), cases);
    assert.deepEqual(got, cases.map((c) => c[2]));
    await v.page.close();
  });
});
