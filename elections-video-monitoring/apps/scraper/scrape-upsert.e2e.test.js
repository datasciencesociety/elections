'use strict';
// End-to-end: the real scraper (Chromium) against a LOCAL fake evideo origin, uploading in
// batches to a real coordinator (server.js on a temp DB). Never points at evideo.bg.
//
//   cd apps/scraper && node --test scrape-upsert.e2e.test.js
//
// Needs Playwright Chromium (or Google Chrome). About 30 s: the scraper spaces page loads 1.5 s apart.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRAPER = path.join(__dirname, 'scrape-streams.js');
const SERVER = path.join(__dirname, '../coordinator/server.js');
const ADMIN = { user: 'e2eadmin', pass: 'e2eadminpass' };
const CODE = 'pvr2026';
// Three OIK pages, scraped one at a time: 40 + 40 + 5 sections → each page is sent as soon as it is
// read, at most 30 rows per upload: 30 + 10, 30 + 10, 5
const OIKS = [40, 40, 5].map((n, o) => Array.from({ length: n }, (_, i) => `${String(o + 1).padStart(2, '0')}46000${String(i + 1).padStart(2, '0')}`));
const STUB = OIKS[0][3];           // pre-seeded without URL, assigned to a volunteer
const DISABLED = OIKS[1][7];       // pre-seeded and disabled by the admin
const OTHER = '239999999';         // not on evideo at all

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
    srv.on('error', reject);
  });
}

let origin, originBase, coordinator, coordBase, proxy, proxyBase, adminCookie, tmp;
let failNextUpserts = 0;

const streamUrl = (sik) => `${originBase}/real/${sik}/index.m3u8`;

function fakeEvideo(req, res) {
  const url = req.url.split('?')[0];
  const html = (body) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(`<!doctype html><html><head><title>evideo</title></head><body>${body}</body></html>`); };
  if (url === `/${CODE}/index.html`) {
    return html(OIKS.map((_, o) => `<a class="oik" href="/${CODE}/oik${o + 1}.html">${o + 1}Район ${o + 1}</a>`).join('\n'));
  }
  const m = url.match(new RegExp(`^/${CODE}/oik(\\d)\\.html$`));
  if (m && OIKS[m[1] - 1]) {
    const sections = OIKS[m[1] - 1].map(sik =>
      `<div class="section" data-sik="${sik}"><div class="section__name">Училище ${sik}</div>` +
      `<button data-vid='["${streamUrl(sik)}"]'>Гледай</button></div>`).join('\n');
    return html(`<div><div><div>${sections}</div></div></div><footer></footer>`);
  }
  res.writeHead(404); res.end();
}

// Coordinator in front of a proxy that can fail the next N upserts with 502
function proxyToCoordinator(req, res) {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    if (req.method === 'POST' && req.url === '/api/streams/upsert' && failNextUpserts > 0) {
      failNextUpserts--;
      res.writeHead(502, { 'Content-Type': 'application/json' }); res.end('{"error":"bad gateway"}');
      return;
    }
    const up = http.request(coordBase + req.url, { method: req.method, headers: req.headers }, (r) => {
      res.writeHead(r.statusCode, r.headers); r.pipe(res);
    });
    up.on('error', () => { res.writeHead(502); res.end(); });
    up.end(Buffer.concat(chunks));
  });
}

async function api(method, p, body) {
  const res = await fetch(coordBase + p, {
    method, headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}
const streams = async () => new Map((await api('GET', '/api/streams')).body.streams.map(s => [s.section, s]));

function scrape(profile, extra = []) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRAPER, `${originBase}/${CODE}/index.html`,
      '--upsert', '--fast', '--concurrency=1', `--profile=${profile}`, ...extra], {
      env: { ...process.env, COORDINATOR_URL: proxyBase, SEED_USER: ADMIN.user, SEED_PASS: ADMIN.pass },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('exit', (code) => resolve({ code, stdout, stderr }));
  });
}

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scrape-e2e-'));
  origin = http.createServer(fakeEvideo);
  await new Promise(r => origin.listen(0, '127.0.0.1', r));
  originBase = `http://127.0.0.1:${origin.address().port}`;

  const port = await freePort();
  coordBase = `http://127.0.0.1:${port}`;
  coordinator = spawn(process.execPath, [SERVER], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DB_PATH: path.join(tmp, 'e2e.db'),
      ADMIN_USER: ADMIN.user, ADMIN_PASS: ADMIN.pass, COOKIE_SECRET: 'e2e-secret', PROXY_URL: 'http://127.0.0.1:1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('coordinator did not start')), 10_000);
    coordinator.stdout.on('data', d => { if (String(d).includes('Election monitor')) { clearTimeout(t); resolve(); } });
    coordinator.on('exit', c => { clearTimeout(t); reject(new Error(`coordinator exited ${c}`)); });
  });
  proxy = http.createServer(proxyToCoordinator);
  await new Promise(r => proxy.listen(0, '127.0.0.1', r));
  proxyBase = `http://127.0.0.1:${proxy.address().port}`;

  const login = await fetch(coordBase + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ADMIN.user, password: ADMIN.pass }) });
  adminCookie = login.headers.get('set-cookie').split(';')[0];
  const seed = await api('POST', '/api/streams/upsert', [
    { section: STUB, url: '', label: 'stub', assigned_users: 'vol9' },
    { section: DISABLED, url: '', label: 'disabled' },
    { section: OTHER, url: 'https://example.test/other.mp4', label: 'other', assigned_users: 'vol8' },
  ]);
  assert.equal(seed.status, 200);
  const before = await streams();
  assert.equal((await api('POST', '/api/streams/toggle', { id: before.get(DISABLED).id, enabled: 0 })).status, 200);
});

after(() => {
  coordinator?.kill();
  origin?.close();
  proxy?.close();
});

describe('scraper --upsert in batches', () => {
  const profile = () => path.join(tmp, 'profile');
  let idsAfterFirst;

  it('uploads in batches of 30 while scraping, retries a failed batch, and fills stubs in place', async () => {
    const before = await streams();
    failNextUpserts = 1;
    const run = await scrape(profile(), ['--batch-size=30']);
    assert.equal(run.code, 0, run.stderr);
    const sizes = [...run.stderr.matchAll(/ upsert (\d+) → /g)].map(m => Number(m[1]));
    assert.deepEqual(sizes, [30, 10, 30, 10, 5], run.stderr);
    assert.match(run.stderr, /retry 1\/3/);
    // Page 1's links, including the 10 under a full batch, went out before page 2 was scraped
    assert.ok(run.stderr.indexOf(' upsert 10 → ') < run.stderr.indexOf('[2/3]'), run.stderr);
    assert.equal(JSON.parse(run.stdout).length, 85);

    const after = await streams();
    for (const sik of OIKS.flat()) assert.equal(after.get(sik)?.url, streamUrl(sik), sik);
    assert.equal(after.size, 86);
    // Stub filled in place: same row, assignment kept
    assert.equal(after.get(STUB).id, before.get(STUB).id);
    assert.equal(after.get(STUB).assigned_users, 'vol9');
    // Admin's disable survives; a section not in any batch is untouched
    assert.equal(after.get(DISABLED).enabled, 0);
    assert.deepEqual(after.get(OTHER), before.get(OTHER));
    idsAfterFirst = new Map([...after].map(([k, v]) => [k, v.id]));
  });

  it('a rerun with the same profile sends nothing', async () => {
    const run = await scrape(profile());
    assert.equal(run.code, 0, run.stderr);
    assert.match(run.stderr, /Resuming: 85 sections already sent/);
    assert.doesNotMatch(run.stderr, / upsert \d+ → /);
  });

  it('a rerun without the progress file resends the same rows and changes nothing', async () => {
    const run = await scrape(path.join(tmp, 'fresh-profile'), ['--batch-size=50']);
    assert.equal(run.code, 0, run.stderr);
    assert.deepEqual([...run.stderr.matchAll(/ upsert (\d+) → (\{[^}]*\})/g)].map(m => [Number(m[1]), JSON.parse(m[2])]),
      [[40, { inserted: 0, updated: 0 }], [40, { inserted: 0, updated: 0 }], [5, { inserted: 0, updated: 0 }]]);
    const after = await streams();
    assert.deepEqual(new Map([...after].map(([k, v]) => [k, v.id])), idsAfterFirst);
    assert.equal(after.get(STUB).assigned_users, 'vol9');
    assert.equal(after.get(DISABLED).enabled, 0);
  });

  it('exits 2 and keeps the rows when the coordinator keeps failing', async () => {
    failNextUpserts = 1000;
    const run = await scrape(path.join(tmp, 'down-profile'), ['--batch-size=100']);
    failNextUpserts = 0;
    assert.equal(run.code, 2, run.stderr);
    assert.match(run.stderr, /85 not sent yet/);
    assert.equal(JSON.parse(run.stdout).length, 85);
  });
});
