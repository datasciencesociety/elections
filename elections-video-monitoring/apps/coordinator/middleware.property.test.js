'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');

// ── Old Property 4 (auth-layer ACL enforcement) removed ─────────────────────
// It referenced the deprecated validateCredentials() API which was replaced
// by the database-backed authenticate(db, username, password) in Task 2.
// ACL enforcement is now covered by Property 9 below (multi-user-auth).

// ── Helpers (shared by Property 9 and Property 10) ──────────────────────────

/**
 * Create a mock request object.
 */
function createMockReq(method, url, cookieHeader) {
  const headers = {};
  if (cookieHeader) {
    headers.cookie = cookieHeader;
  }
  return { method, url, headers };
}

/**
 * Create a mock response object that captures writeHead/end calls.
 */
function createMockRes() {
  const res = {
    _statusCode: null,
    _headers: {},
    _body: null,
    _ended: false,
    writeHead(statusCode, headers) {
      res._statusCode = statusCode;
      if (headers) {
        Object.assign(res._headers, headers);
      }
    },
    end(body) {
      res._body = body || null;
      res._ended = true;
    },
  };
  return res;
}


// ── Property 9: ACL enforcement for user management routes ──────────────────
// Feature: multi-user-auth, Property 9: ACL enforcement for user management routes
// **Validates: Requirements 10.1–10.8**

describe('Property 9: ACL enforcement for user management routes', () => {
  let classifyRoute;
  let authMiddleware;
  let createSessionCookie;

  beforeEach(() => {
    // Clear module caches to get fresh state
    delete require.cache[require.resolve('./auth')];
    delete require.cache[require.resolve('./middleware')];

    const auth = require('./auth');
    createSessionCookie = auth.createSessionCookie;
    ({ classifyRoute, authMiddleware } = require('./middleware'));
  });

  afterEach(() => {
    delete require.cache[require.resolve('./auth')];
    delete require.cache[require.resolve('./middleware')];
  });

  // User management endpoints under test
  const USER_MGMT_ROUTES = [
    { method: 'POST',   path: '/api/users' },
    { method: 'GET',    path: '/api/users' },
    { method: 'POST',   path: '/api/users/bulk' },
    // DELETE /api/users/<username> tested with random usernames below
  ];

  it('classifyRoute returns admin/json401 for all user management endpoints', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...USER_MGMT_ROUTES),
        (route) => {
          const result = classifyRoute(route.method, route.path);
          assert.deepStrictEqual(result, { minRole: 'admin', denyAction: 'json401' },
            `Expected admin/json401 for ${route.method} ${route.path}, got ${JSON.stringify(result)}`);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('classifyRoute returns admin/json401 for DELETE /api/users/<username> with random usernames', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }).filter(s => !s.includes('/') && !s.includes('?') && !s.includes('#') && s.trim().length > 0),
        (username) => {
          const result = classifyRoute('DELETE', `/api/users/${username}`);
          assert.deepStrictEqual(result, { minRole: 'admin', denyAction: 'json401' },
            `Expected admin/json401 for DELETE /api/users/${username}, got ${JSON.stringify(result)}`);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('authMiddleware denies unauthenticated requests to user management routes with 401 JSON', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          ...USER_MGMT_ROUTES,
          { method: 'DELETE', path: '/api/users/someuser' }
        ),
        (route) => {
          const req = createMockReq(route.method, route.path, null);
          const res = createMockRes();

          const handled = authMiddleware(req, res);

          assert.equal(handled, true,
            `Unauthenticated ${route.method} ${route.path} should be handled (denied)`);
          assert.equal(res._statusCode, 401,
            `Unauthenticated ${route.method} ${route.path} should return 401`);
          assert.equal(res._body, JSON.stringify({ error: 'Unauthorized' }),
            `Unauthenticated ${route.method} ${route.path} should return Unauthorized JSON`);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('authMiddleware denies volunteer-authenticated requests to user management routes with 401 JSON', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          ...USER_MGMT_ROUTES,
          { method: 'DELETE', path: '/api/users/someuser' }
        ),
        (route) => {
          const cookieHeader = 'session=' + createSessionCookie('vol1', 'volunteer');
          const req = createMockReq(route.method, route.path, cookieHeader);
          const res = createMockRes();

          const handled = authMiddleware(req, res);

          assert.equal(handled, true,
            `Volunteer ${route.method} ${route.path} should be handled (denied)`);
          assert.equal(res._statusCode, 401,
            `Volunteer ${route.method} ${route.path} should return 401`);
          assert.equal(res._body, JSON.stringify({ error: 'Unauthorized' }),
            `Volunteer ${route.method} ${route.path} should return Unauthorized JSON`);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('authMiddleware allows admin-authenticated requests to user management routes', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          ...USER_MGMT_ROUTES,
          { method: 'DELETE', path: '/api/users/someuser' }
        ),
        (route) => {
          const cookieHeader = 'session=' + createSessionCookie('admin1', 'admin');
          const req = createMockReq(route.method, route.path, cookieHeader);
          const res = createMockRes();

          const handled = authMiddleware(req, res);

          assert.equal(handled, false,
            `Admin ${route.method} ${route.path} should pass through (not handled)`);
          assert.deepStrictEqual(req.user, { username: 'admin1', role: 'admin' },
            `Admin ${route.method} ${route.path} should set req.user`);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('authMiddleware denies DELETE /api/users/<random-username> for unauthenticated and volunteer', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }).filter(s => !s.includes('/') && !s.includes('?') && !s.includes('#') && s.trim().length > 0),
        fc.constantFrom('unauthenticated', 'volunteer'),
        (username, authState) => {
          let cookieHeader = null;
          if (authState === 'volunteer') {
            cookieHeader = 'session=' + createSessionCookie('vol1', 'volunteer');
          }

          const req = createMockReq('DELETE', `/api/users/${username}`, cookieHeader);
          const res = createMockRes();

          const handled = authMiddleware(req, res);

          assert.equal(handled, true,
            `${authState} DELETE /api/users/${username} should be denied`);
          assert.equal(res._statusCode, 401,
            `${authState} DELETE /api/users/${username} should return 401`);
          assert.equal(res._body, JSON.stringify({ error: 'Unauthorized' }),
            `${authState} DELETE /api/users/${username} should return Unauthorized JSON`);
        }
      ),
      { numRuns: 100 }
    );
  });
});


// ── Property 10: Middleware attaches req.user from cookie ────────────────────
// Feature: multi-user-auth, Property 10: Middleware attaches req.user from cookie
// **Validates: Requirements 11.2**

describe('Property 10: Middleware attaches req.user from cookie', () => {
  let authMiddleware;
  let createSessionCookie;

  beforeEach(() => {
    delete require.cache[require.resolve('./auth')];
    delete require.cache[require.resolve('./middleware')];

    const auth = require('./auth');
    createSessionCookie = auth.createSessionCookie;
    ({ authMiddleware } = require('./middleware'));
  });

  afterEach(() => {
    delete require.cache[require.resolve('./auth')];
    delete require.cache[require.resolve('./middleware')];
  });

  it('req.user matches cookie payload for any valid username and role', () => {
    const usernameArb = fc.string({ minLength: 1, maxLength: 50 })
      .filter(s => s.trim().length > 0);
    const roleArb = fc.constantFrom('admin', 'volunteer');

    fc.assert(
      fc.property(usernameArb, roleArb, (username, role) => {
        const cookieValue = createSessionCookie(username, role);
        const cookieHeader = 'session=' + cookieValue;

        // Pick a route the role has access to:
        // admin -> GET /api/users (admin-only), volunteer -> GET / (volunteer-or-above)
        const url = role === 'admin' ? '/api/users' : '/';
        const req = createMockReq('GET', url, cookieHeader);
        const res = createMockRes();

        const handled = authMiddleware(req, res);

        // The request should pass through (not denied)
        assert.equal(handled, false,
          `${role} user "${username}" should be allowed through for GET ${url}`);

        // req.user must be set and match the cookie payload
        assert.ok(req.user,
          `req.user should be set after middleware for ${role} user "${username}"`);
        assert.equal(req.user.username, username,
          `req.user.username should be "${username}", got "${req.user.username}"`);
        assert.equal(req.user.role, role,
          `req.user.role should be "${role}", got "${req.user.role}"`);
      }),
      { numRuns: 100 }
    );
  });
});
