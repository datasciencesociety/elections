'use strict';
// node --test scripts/seed.test.js
//
// Runs scripts/seed.js against real coordinators (server.js on temp DBs), some behind a tiny proxy
// that refuses bodies over 1 MB with an HTML 413 like nginx's default client_max_body_size.
// - One replace request and a batched replace (--batch-size=500) of ~12,000 stubs end with the
//   same streams, contacts and stream_contacts, row for row.
// - A 413 or any non-JSON answer gives a clear error and exit code 1 in every mode.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { DatabaseSync } = require('node:sqlite');

const SERVER = path.join(__dirname, '../apps/coordinator/server.js');
const SEED = path.join(__dirname, 'seed.js');
const ADMIN = { SEED_USER: 'testadmin', SEED_PASS: 'testadminpass' };
const NGINX_LIMIT = 1024 * 1024;
const N_BIG = 12_000;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-test-'));
const servers = [];

function listen(srv) {
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${srv.address().port}`)));
}

function freePort() {
  return new Promise((resolve) => {
    const srv = http.createServer();
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
  });
}

async function startServer(name) {
  const port = await freePort();
  const dbPath = path.join(tmpDir, `${name}.db`);
  const child = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env, PORT: String(port), DB_PATH: dbPath,
      ADMIN_USER: ADMIN.SEED_USER, ADMIN_PASS: ADMIN.SEED_PASS,
      COOKIE_SECRET: 'test-secret', PROXY_URL: 'http://127.0.0.1:1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start')), 10_000);
    child.stdout.on('data', (d) => { if (d.toString().includes('Election monitor')) { clearTimeout(timer); resolve(); } });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited ${code}`)); });
  });
  const s = { base: `http://127.0.0.1:${port}`, dbPath, child };
  servers.push(s);
  return s;
}

function stopServer(s) {
  if (s.child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => { s.child.once('exit', resolve); s.child.kill(); });
}

/** Proxy in front of `target` that answers a body over 1 MB like nginx: 413 with an HTML page. */
async function startLimitProxy(target) {
  const t = new URL(target);
  const srv = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      if (body.length > NGINX_LIMIT) {
        res.writeHead(413, { 'Content-Type': 'text/html' });
        res.end('<html>\r\n<head><title>413 Request Entity Too Large</title></head>\r\n<body>\r\n<center><h1>413 Request Entity Too Large</h1></center>\r\n<hr><center>nginx</center>\r\n</body>\r\n</html>\r\n');
        return;
      }
      const up = http.request({ host: t.hostname, port: t.port, method: req.method, path: req.url, headers: { ...req.headers, host: t.host } }, (r) => {
        res.writeHead(r.statusCode, r.headers);
        r.pipe(res);
      });
      up.on('error', () => { res.writeHead(502); res.end(); });
      up.end(body);
    });
  });
  const base = await listen(srv);
  return { base, close: () => new Promise((r) => srv.close(r)) };
}

/** Fake coordinator: logs in fine, then answers every other request with `answer`. */
async function startFake(answer) {
  const srv = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      if (req.url === '/api/login') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': 'session=x; Path=/' });
        res.end(JSON.stringify({ role: 'admin' }));
      } else if (req.url === '/api/streams/count') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"count":0}');
      } else answer(res);
    });
  });
  const base = await listen(srv);
  return { base, close: () => new Promise((r) => srv.close(r)) };
}

function runSeed(base, args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SEED, ...args], {
      env: { ...process.env, ...ADMIN, COORDINATOR_URL: base },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('exit', (code) => resolve({ code, stdout, stderr }));
  });
}

// ~12,000 stubs like the runoff file, plus contacts (shared, without phone, changing role),
// assigned_users in every form replace and upsert treat differently, and numeric labels
function stubFile(name, n) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    const section = String(10_000_0000 + i * 7).padStart(9, '0');
    const row = { section, url: `https://127.0.0.1/real/${section}/index.m3u8`, label: i % 97 === 0 ? i : `Секция ${section}, гр. Тест ${i % 31}` };
    if (i % 10 === 0) row.contacts = [{ name: `Контакт ${i % 40}`, phone: i % 3 ? `0888${String(i % 40).padStart(6, '0')}` : undefined, role: i % 20 ? 'ПСИК' : 'СИК' }];
    if (i % 25 === 0) row.contacts = [...(row.contacts || []), { name: 'Общ', phone: '0899000000', role: `r${i % 4}` }];
    if (i % 11 === 0) row.assigned_users = '';
    if (i % 13 === 0) row.assigned_users = 'vol1,vol2';
    if (i % 17 === 0) row.assigned_users = null;
    rows.push(row);
  }
  const file = path.join(tmpDir, name);
  fs.writeFileSync(file, JSON.stringify(rows));
  return { file, rows };
}

function dump(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const out = {
    streams: db.prepare('SELECT id, section, url, label, enabled, assigned_users, last_checked FROM streams ORDER BY id').all(),
    contacts: db.prepare('SELECT id, name, phone, role FROM contacts ORDER BY id').all(),
    stream_contacts: db.prepare('SELECT stream_id, contact_id FROM stream_contacts ORDER BY stream_id, contact_id').all(),
    sessions: db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,
    reports: db.prepare('SELECT COUNT(*) AS n FROM reports').get().n,
  };
  db.close();
  return out;
}

after(async () => {
  await Promise.all(servers.map(stopServer));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('seed.js --replace --batch-size', () => {
  const N = 12_000;
  let file, rows, oneShot, batched;

  before(async () => {
    ({ file, rows } = stubFile('stubs.json', N));
    // Same earlier state on both: streams and contacts a replace must wipe or keep
    const { file: old } = stubFile('old.json', 300);
    const a = await startServer('oneshot');
    const b = await startServer('batched');
    for (const s of [a, b]) {
      const r = await runSeed(s.base, [old, '--replace', '--force']);
      assert.equal(r.code, 0, r.stderr);
    }

    const r1 = await runSeed(a.base, [file, '--stubs', '--replace', '--force']);
    assert.equal(r1.code, 0, r1.stderr);
    // The batched replace goes through a proxy with nginx's 1 MB limit, as on the live site
    const proxy = await startLimitProxy(b.base);
    const r2 = await runSeed(proxy.base, [file, '--stubs', '--replace', '--force', '--batch-size=500']);
    await proxy.close();
    assert.equal(r2.code, 0, r2.stderr);
    assert.match(r2.stdout, /500 in the replace request, 11500 upserted in batches of 500/);

    await Promise.all([stopServer(a), stopServer(b)]);
    oneShot = dump(a.dbPath);
    batched = dump(b.dbPath);
  });

  it('loads every stub', () => {
    assert.equal(oneShot.streams.length, N);
    assert.ok(oneShot.streams.every(s => s.url === ''));
    assert.ok(oneShot.stream_contacts.length > 1000);
    assert.equal(oneShot.sessions, 0);
    assert.equal(oneShot.reports, 0);
    assert.equal(new Set(oneShot.streams.map(s => s.section)).size, rows.length);
  });

  it('ends with the same streams as one replace request', () => {
    assert.equal(batched.streams.length, oneShot.streams.length);
    assert.deepEqual(batched.streams, oneShot.streams);
  });

  it('ends with the same contacts and stream_contacts', () => {
    assert.deepEqual(batched.contacts, oneShot.contacts);
    assert.deepEqual(batched.stream_contacts, oneShot.stream_contacts);
  });

  it('refuses a file a batched replace would load differently, before wiping anything', async () => {
    const s = await startServer('refuse');
    const dupFile = path.join(tmpDir, 'dup.json');
    fs.writeFileSync(dupFile, JSON.stringify([...rows.slice(0, 600), rows[3]]));
    const before = await runSeed(s.base, [dupFile, '--stubs', '--replace', '--force', '--batch-size=500']);
    assert.equal(before.code, 1);
    assert.match(before.stderr, /appear more than once.*Nothing was changed/);
    const noLabel = path.join(tmpDir, 'nolabel.json');
    fs.writeFileSync(noLabel, JSON.stringify([...rows.slice(0, 600), { section: '999999999', url: '' }]));
    const r = await runSeed(s.base, [noLabel, '--replace', '--force', '--batch-size=500']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /have no label/);
    await stopServer(s);
    assert.equal(dump(s.dbPath).streams.length, 0);
  });
});

describe('seed.js on a response that is not JSON', () => {
  let coord, proxy, big;

  before(async () => {
    coord = await startServer('limit');
    proxy = await startLimitProxy(coord.base);
    ({ file: big } = stubFile('big.json', N_BIG));
  });
  after(async () => { await proxy.close(); await stopServer(coord); });

  const html413 = /→ 413 [A-Za-z ]+ \(text\/html\): <html> <head><title>413 Request Entity Too Large<\/title>/;

  it('replace in one request: 413 page → clear error, exit 1', async () => {
    const r = await runSeed(proxy.base, [big, '--stubs', '--replace', '--force']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /^Error: POST http:\/\/127\.0\.0\.1:\d+\/api\/streams → /m);
    assert.match(r.stderr, html413);
    assert.doesNotMatch(r.stderr, /SyntaxError|Unexpected token/);
  });

  it('upsert in one request: 413 page → clear error, exit 1', async () => {
    const r = await runSeed(proxy.base, [big, '--stubs']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /^Error: POST http:\/\/127\.0\.0\.1:\d+\/api\/streams\/upsert → /m);
    assert.match(r.stderr, html413);
  });

  it('upsert in batches: 413 page → retried, then clear error, exit 1', { timeout: 60_000 }, async () => {
    const r = await runSeed(proxy.base, [big, '--stubs', `--batch-size=${N_BIG}`]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /retry 3\/3/);
    assert.match(r.stderr, html413);
    assert.match(r.stderr, /^Error: \d+ row\(s\) from .* not sent; rerun/m);
  });

  it('a 200 HTML page is an error too, not success', async () => {
    const fake = await startFake((res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html><body>Login portal</body></html>'); });
    const r = await runSeed(fake.base, [big, '--stubs', '--replace', '--force']);
    await fake.close();
    assert.equal(r.code, 1);
    assert.match(r.stderr, /→ 200 OK \(text\/html\): <html><body>Login portal/);
  });

  it('the body in the error is cut to 200 characters', async () => {
    const fake = await startFake((res) => { res.writeHead(502, { 'Content-Type': 'text/plain' }); res.end('x'.repeat(5000)); });
    const r = await runSeed(fake.base, [big, '--stubs']);
    await fake.close();
    assert.equal(r.code, 1);
    assert.match(r.stderr, /→ 502 Bad Gateway \(text\/plain\): x{200}\n/);
  });
});
