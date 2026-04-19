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

/**
 * Determine the route's required role and deny action.
 * @param {string} method - HTTP method
 * @param {string} urlPath - URL path (without query string)
 * @returns {{ minRole: string|null, denyAction: string|null }}
 */
function classifyRoute(method, urlPath) {
  // Public routes — no auth needed
  if (method === 'GET' && urlPath === '/login') {
    return { minRole: null, denyAction: null };
  }
  if (method === 'POST' && urlPath === '/api/login') {
    return { minRole: null, denyAction: null };
  }
  if (method === 'POST' && urlPath === '/api/logout') {
    return { minRole: null, denyAction: null };
  }
  // Login static assets: paths ending in .js or .css that are children of /login
  if (method === 'GET' && urlPath.startsWith('/login/') && (urlPath.endsWith('.js') || urlPath.endsWith('.css'))) {
    return { minRole: null, denyAction: null };
  }

  // Admin-only routes
  if (method === 'GET' && urlPath === '/admin') {
    return { minRole: 'admin', denyAction: 'redirect' };
  }
  if (method === 'POST' && urlPath === '/api/streams') {
    return { minRole: 'admin', denyAction: 'json401' };
  }

  // Admin-only user management routes
  if (method === 'POST' && urlPath === '/api/users/bulk') {
    return { minRole: 'admin', denyAction: 'json401' };
  }
  if (method === 'POST' && urlPath === '/api/users') {
    return { minRole: 'admin', denyAction: 'json401' };
  }
  if (method === 'GET' && urlPath === '/api/users') {
    return { minRole: 'admin', denyAction: 'json401' };
  }
  if (method === 'DELETE' && urlPath.startsWith('/api/users/')) {
    return { minRole: 'admin', denyAction: 'json401' };
  }

  // Volunteer-or-above page routes (302 redirect on deny)
  if (method === 'GET' && urlPath === '/') {
    return { minRole: 'volunteer', denyAction: 'redirect' };
  }
  if (method === 'GET' && urlPath === '/poc') {
    return { minRole: 'volunteer', denyAction: 'redirect' };
  }
  if (method === 'GET' && (urlPath === '/inspect' || urlPath.startsWith('/inspect/'))) {
    return { minRole: 'volunteer', denyAction: 'redirect' };
  }

  // Volunteer-or-above API routes (401 JSON on deny)
  if (method === 'POST' && urlPath === '/api/session') {
    return { minRole: 'volunteer', denyAction: 'json401' };
  }
  if (method === 'POST' && urlPath === '/api/heartbeat') {
    return { minRole: 'volunteer', denyAction: 'json401' };
  }
  if (method === 'POST' && urlPath === '/api/report') {
    return { minRole: 'volunteer', denyAction: 'json401' };
  }
  if (method === 'GET' && urlPath === '/api/flagged') {
    return { minRole: 'volunteer', denyAction: 'json401' };
  }
  if (method === 'GET' && urlPath === '/api/streams/count') {
    return { minRole: 'volunteer', denyAction: 'json401' };
  }

  // Proxy routes — volunteer-or-above, 401 on deny
  if (urlPath.startsWith('/proxy/')) {
    return { minRole: 'volunteer', denyAction: 'json401' };
  }

  // Unknown routes — fall through to existing handlers (e.g. 404)
  return { minRole: null, denyAction: null };
}

/**
 * Auth middleware. Returns true if the request was handled
 * (redirected or rejected), false if the caller should continue
 * to the normal route handler.
 *
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @returns {boolean} handled
 */
function authMiddleware(req, res) {
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
  const userRole = session ? session.role : null;

  // Check if user has sufficient role
  if (hasRole(userRole, minRole)) {
    req.user = { username: session.username, role: session.role };
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
