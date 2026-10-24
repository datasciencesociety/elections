'use strict';

const { verifySessionCookie } = require('./auth');

/**
 * Parse the value of a specific cookie from the Cookie header.
 * @param {http.IncomingMessage} req
 * @param {string} name
 * @returns {string|null}
 */
function parseCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;

  const cookies = header.split(';');
  for (const cookie of cookies) {
    const [key, ...rest] = cookie.split('=');
    if (key.trim() === name) {
      return rest.join('=').trim() || null;
    }
  }
  return null;
}

/**
 * Role hierarchy check. Admin is a superset of volunteer.
 * @param {string|null} userRole - The authenticated user's role (or null)
 * @param {string} requiredRole - "admin" or "volunteer"
 * @returns {boolean}
 */
function hasRole(userRole, requiredRole) {
  if (!userRole) return false;
  if (requiredRole === 'volunteer') return userRole === 'volunteer' || userRole === 'admin';
  if (requiredRole === 'admin') return userRole === 'admin';
  return false;
}

// Routes anyone may call. Stream listings are public by design (read-only).
const PUBLIC_ROUTES = new Set([
  'GET /login',
  'POST /api/login',
  'POST /api/logout',
  'GET /favicon.ico',
  'GET /api/streams',
  'GET /api/streams/count',
  'GET /api/streams/stats',
  'GET /api/streams/available',
]);

// Routes that need the admin role. Everything else needs volunteer-or-above.
const ADMIN_ROUTES = new Set([
  'GET /admin',
  'POST /api/streams',
  'POST /api/streams/upsert',
  'POST /api/streams/toggle',
  'POST /api/users',
  'POST /api/users/bulk',
  'GET /api/users',
]);

/**
 * Determine the route's required role and deny action.
 * Default-deny: any route not listed as public requires at least volunteer.
 * @param {string} method - HTTP method
 * @param {string} urlPath - URL path (without query string)
 * @returns {{ minRole: string|null, denyAction: string|null }}
 */
function classifyRoute(method, urlPath) {
  const key = `${method} ${urlPath}`;
  // Pages redirect to /login on deny; API and asset requests get 401 JSON
  const denyAction = method === 'GET' && !urlPath.startsWith('/api/') ? 'redirect' : 'json401';

  if (PUBLIC_ROUTES.has(key)) {
    return { minRole: null, denyAction: null };
  }
  // Login static assets: paths ending in .js or .css that are children of /login
  if (method === 'GET' && urlPath.startsWith('/login/') && (urlPath.endsWith('.js') || urlPath.endsWith('.css'))) {
    return { minRole: null, denyAction: null };
  }

  if (ADMIN_ROUTES.has(key) || (method === 'DELETE' && urlPath.startsWith('/api/users/'))) {
    return { minRole: 'admin', denyAction };
  }

  return { minRole: 'volunteer', denyAction };
}

/**
 * Auth middleware. Returns true if the request was handled
 * (redirected or rejected), false if the caller should continue
 * to the normal route handler.
 *
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @param {{ lookupRole?: (username: string) => string|null }} [opts]
 *   lookupRole returns the user's current role from the DB (null if deleted),
 *   so deleted or demoted users lose access before their cookie expires.
 * @returns {boolean} handled
 */
function authMiddleware(req, res, opts = {}) {
  const urlPath = req.url.split('?')[0];
  const method = req.method;

  const { minRole, denyAction } = classifyRoute(method, urlPath);

  // Public route — no auth required
  if (minRole === null) {
    return false;
  }

  // Extract and verify session cookie
  const cookieValue = parseCookie(req, 'session');
  const session = cookieValue ? verifySessionCookie(cookieValue) : null;
  let userRole = session ? session.role : null;
  if (session && opts.lookupRole) userRole = opts.lookupRole(session.username);

  // Check if user has sufficient role
  if (hasRole(userRole, minRole)) {
    req.user = { username: session.username, role: userRole };
    return false;
  }

  // Insufficient access — deny
  if (denyAction === 'redirect') {
    res.writeHead(302, { Location: '/login' });
    res.end();
    return true;
  }

  if (denyAction === 'json401') {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return true;
  }

  return false;
}

module.exports = { authMiddleware, classifyRoute };
