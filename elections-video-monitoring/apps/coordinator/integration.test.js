'use strict';

const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Make an HTTP request and return { statusCode, headers, body }.
 */
function request(port, method, urlPath, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: '127.0.0.1',
      port,
      path: urlPath,
      method,
      headers: { ...headers },
    };
    if (body !== undefined) {
      const payload = typeof body === 'string' ? body : JSON.stringify(body);
      opts.headers['Content-Type'] = 'application/json';
      opts.headers['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = http.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        let parsed;
        try { parsed = JSON.parse(raw); } catch { parsed = raw; }
        resolve({ statusCode: res.statusCode, headers: res.headers, body: parsed });
      });
    });
    req.on('error', reject);
    if (body !== undefined) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

// ── Credential validation test (no server needed) ───────────────────────────

describe('Credential validation at startup', () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
    delete require.cache[require.resolve('./auth')];
  });

  for (const varName of ['ADMIN_USER', 'ADMIN_PASS', 'VOLUNTEER_USER', 'VOLUNTEER_PASS']) {
    it(`should exit with code 1 when ${varName} is missing`, () => {
      process.env.ADMIN_USER = 'a';
      process.env.ADMIN_PASS = 'b';
      process.env.VOLUNTEER_USER = 'c';
      process.env.VOLUNTEER_PASS = 'd';
      delete process.env[varName];

      const { validateCredentials } = require('./auth');

      let exitCode = null;
      const origExit = process.exit;
      process.exit = (code) => { exitCode = code; };

      try {
        validateCredentials();
        assert.equal(exitCode, 1);
      } finally {
        process.exit = origExit;
      }
    });

    it(`should exit with code 1 when ${varName} is empty`, () => {
      process.env.ADMIN_USER = 'a';
      process.env.ADMIN_PASS = 'b';
      process.env.VOLUNTEER_USER = 'c';
      process.env.VOLUNTEER_PASS = 'd';
      process.env[varName] = '';

      const { validateCredentials } = require('./auth');

      let exitCode = null;
      const origExit = process.exit;
      process.exit = (code) => { exitCode = code; };

      try {
        validateCredentials();
        assert.equal(exitCode, 1);
      } finally {
        process.exit = origExit;
      }
    });
  }
});

// ── Integration tests with running server ───────────────────────────────────

describe('Server integration', () => {
  let server;
  let port;
  let adminCookie;
  let volunteerCookie;

  before(async () => {
    // Set credential env vars before loading the server module
    process.env.ADMIN_USER = 'testadmin';
    process.env.ADMIN_PASS = 'testadminpass';
    process.env.VOLUNTEER_USER = 'testvol';
    process.env.VOLUNTEER_PASS = 'testvolpass';
    process.env.PORT = '0'; // let OS pick a free port

    // Use a temp DB path so we don't pollute the real data
    const tmpDir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'coord-test-'));
    process.env.DB_PATH = path.join(tmpDir, 'test.db');

    // Clear cached modules to pick up fresh env
    delete require.cache[require.resolve('./auth')];
    delete require.cache[require.resolve('./middleware')];
    delete require.cache[require.resolve('./server')];

    // Load the server module — it calls validateCredentials() and server.listen()
    // We need to capture the server instance. The server.js module creates and
    // listens on a server but doesn't export it, so we'll build our own server
    // using the same pattern.

    // Instead of requiring server.js (which auto-starts), we'll create our own
    // minimal server that uses the same auth functions and middleware.
    const { validateCredentials, authenticate, createSessionCookie, buildSetCookie, buildClearCookie } = require('./auth');
    const { authMiddleware } = require('./middleware');

    validateCredentials();

    // Pre-create cookies for authenticated requests
    adminCookie = `session=${createSessionCookie('testadmin', 'admin')}`;
    volunteerCookie = `session=${createSessionCookie('testvol', 'volunteer')}`;

    // Create a minimal server that mirrors the auth-related routes from server.js
    const publicDir = path.join(__dirname, 'public');

    server = http.createServer(async (req, res) => {
      const url = req.url.split('?')[0];

      try {
        // Auth middleware
        if (authMiddleware(req, res)) return;

        // Static pages
        if (req.method === 'GET' && url === '/') {
          const filePath = path.join(publicDir, 'volunteer.html');
          try {
            const data = fs.readFileSync(filePath);
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(data);
          } catch {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<html><body>Volunteer</body></html>');
          }
          return;
        }
        if (req.method === 'GET' && url === '/admin') {
          const filePath = path.join(publicDir, 'admin.html');
          try {
            const data = fs.readFileSync(filePath);
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(data);
          } catch {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<html><body>Admin</body></html>');
          }
          return;
        }

        // Auth routes
        if (req.method === 'GET' && url === '/login') {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<html><body>Login</body></html>');
          return;
        }
        if (req.method === 'POST' && url === '/api/login') {
          const body = await readBody(req);
          const { username, password } = body;
          if (!username || !password) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Username and password required' }));
            return;
          }
          const result = authenticate(username, password);
          if (!result) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid credentials' }));
            return;
          }
          const cookie = createSessionCookie(username, result.role);
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Set-Cookie': buildSetCookie(cookie),
          });
          res.end(JSON.stringify({ role: result.role }));
          return;
        }
        if (req.method === 'POST' && url === '/api/logout') {
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Set-Cookie': buildClearCookie(),
          });
          res.end(JSON.stringify({ ok: true }));
          return;
        }

        // API routes (stub — just need them to exist for auth testing)
        if (req.method === 'POST' && url === '/api/streams') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
          return;
        }

        res.writeHead(404);
        res.end();
      } catch (err) {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      }
    });

    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        port = server.address().port;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    // Clean up module cache
    delete require.cache[require.resolve('./auth')];
    delete require.cache[require.resolve('./middleware')];
  });

  // ── Login tests ─────────────────────────────────────────────────────────

  it('POST /api/login with valid admin creds returns 200, role, and Set-Cookie with HttpOnly + SameSite=Strict + Path=/', async () => {
    const res = await request(port, 'POST', '/api/login', {
      body: { username: 'testadmin', password: 'testadminpass' },
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.role, 'admin');

    const setCookie = res.headers['set-cookie'];
    assert.ok(setCookie, 'Expected Set-Cookie header');
    const cookieStr = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    assert.ok(cookieStr.includes('HttpOnly'), 'Cookie should have HttpOnly');
    assert.ok(cookieStr.includes('SameSite=Strict'), 'Cookie should have SameSite=Strict');
    assert.ok(cookieStr.includes('Path=/'), 'Cookie should have Path=/');
  });

  it('POST /api/login with valid volunteer creds returns 200 and role', async () => {
    const res = await request(port, 'POST', '/api/login', {
      body: { username: 'testvol', password: 'testvolpass' },
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.role, 'volunteer');
  });

  it('POST /api/login with invalid creds returns 401', async () => {
    const res = await request(port, 'POST', '/api/login', {
      body: { username: 'wrong', password: 'wrong' },
    });

    assert.equal(res.statusCode, 401);
    assert.equal(res.body.error, 'Invalid credentials');
  });

  // ── Logout test ─────────────────────────────────────────────────────────

  it('POST /api/logout clears cookie and returns 200', async () => {
    const res = await request(port, 'POST', '/api/logout');

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { ok: true });

    const setCookie = res.headers['set-cookie'];
    assert.ok(setCookie, 'Expected Set-Cookie header');
    const cookieStr = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    assert.ok(cookieStr.includes('session=;') || cookieStr.includes('session= ;'), 'Cookie should be cleared');
    assert.ok(cookieStr.includes('Expires='), 'Cookie should have Expires for clearing');
  });

  // ── Admin route protection ──────────────────────────────────────────────

  it('unauthenticated GET /admin redirects to /login', async () => {
    const res = await request(port, 'GET', '/admin');

    assert.equal(res.statusCode, 302);
    assert.equal(res.headers.location, '/login');
  });

  it('volunteer cookie on GET /admin redirects to /login', async () => {
    const res = await request(port, 'GET', '/admin', {
      headers: { Cookie: volunteerCookie },
    });

    assert.equal(res.statusCode, 302);
    assert.equal(res.headers.location, '/login');
  });

  it('admin cookie on GET /admin returns 200', async () => {
    const res = await request(port, 'GET', '/admin', {
      headers: { Cookie: adminCookie },
    });

    assert.equal(res.statusCode, 200);
  });

  // ── API route protection ────────────────────────────────────────────────

  it('unauthenticated POST /api/streams returns 401', async () => {
    const res = await request(port, 'POST', '/api/streams');

    assert.equal(res.statusCode, 401);
    assert.equal(res.body.error, 'Unauthorized');
  });

  // ── Volunteer route protection ──────────────────────────────────────────

  it('unauthenticated GET / redirects to /login', async () => {
    const res = await request(port, 'GET', '/');

    assert.equal(res.statusCode, 302);
    assert.equal(res.headers.location, '/login');
  });

  it('volunteer cookie on GET / returns 200', async () => {
    const res = await request(port, 'GET', '/', {
      headers: { Cookie: volunteerCookie },
    });

    assert.equal(res.statusCode, 200);
  });
});

// ── Utility ─────────────────────────────────────────────────────────────────

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}
