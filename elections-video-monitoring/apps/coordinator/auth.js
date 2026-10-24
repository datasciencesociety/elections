'use strict';

const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');

// Set COOKIE_SECRET so logins survive restarts; otherwise every restart logs everyone out.
const COOKIE_SECRET = process.env.COOKIE_SECRET || crypto.randomBytes(32);
const COOKIE_TTL_MS = parseInt(process.env.COOKIE_TTL_MS, 10) || 24 * 60 * 60 * 1000; // 24 h default
// Only enable behind HTTPS — browsers drop Secure cookies set over plain HTTP.
const COOKIE_SECURE = process.env.COOKIE_SECURE === '1';

/**
 * Initialize the user store. If the users table is empty, seed an admin
 * account from ADMIN_USER / ADMIN_PASS env vars. If the table already has
 * users, skip seeding (env vars not required).
 * @param {import('node:sqlite').DatabaseSync} db
 */
function initUserStore(db) {
  const row = db.prepare('SELECT COUNT(*) AS cnt FROM users').get();
  if (row.cnt === 0) {
    const adminUser = process.env.ADMIN_USER;
    const adminPass = process.env.ADMIN_PASS;

    if (!adminUser) {
      console.error('Missing or empty environment variable: ADMIN_USER (required for first-time startup with empty users table)');
      process.exit(1);
    }
    if (!adminPass) {
      console.error('Missing or empty environment variable: ADMIN_PASS (required for first-time startup with empty users table)');
      process.exit(1);
    }

    const hash = hashPassword(adminPass);
    db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(adminUser, hash, 'admin');
  }
  // If table already has users, skip seeding — ADMIN_USER/ADMIN_PASS not required
}

/**
 * Hash a plaintext password with bcrypt (cost 10).
 * @param {string} password
 * @returns {string} bcrypt hash
 */
function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}

/**
 * Hash a plaintext password with bcrypt (cost 10) — async version.
 * Use this for bulk operations to avoid blocking the event loop.
 * @param {string} password
 * @returns {Promise<string>} bcrypt hash
 */
function hashPasswordAsync(password) {
  return bcrypt.hash(password, 10);
}

/**
 * Authenticate against the users table.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} username
 * @param {string} password
 * @returns {{ role: string } | null}
 */
function authenticate(db, username, password) {
  const row = db.prepare('SELECT password_hash, role FROM users WHERE username = ?').get(username);
  if (!row) return null;
  if (!bcrypt.compareSync(password, row.password_hash)) return null;
  return { role: row.role };
}

/**
 * Add a user to the store. Throws on duplicate username (SQLite UNIQUE constraint).
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} username
 * @param {string} passwordHash
 * @param {string} role
 */
function addUser(db, username, passwordHash, role) {
  db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(username, passwordHash, role);
}

/**
 * Remove a user from the store.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} username
 * @returns {boolean} true if a user was deleted, false if not found
 */
function removeUser(db, username) {
  const result = db.prepare('DELETE FROM users WHERE username = ?').run(username);
  return result.changes > 0;
}

/**
 * List all users (username + role only, no password hashes).
 * @param {import('node:sqlite').DatabaseSync} db
 * @returns {Array<{ username: string, role: string }>}
 */
function listUsers(db) {
  return db.prepare('SELECT username, role FROM users').all();
}

/**
 * Create a signed cookie value for the given user.
 * @param {string} username
 * @param {string} role
 * @param {number} [now] - issue time in ms (for tests)
 * @returns {string} cookie value: base64url(payload) + "." + hmac_hex
 */
function createSessionCookie(username, role, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ u: username, r: role, e: now + COOKIE_TTL_MS })).toString('base64url');
  const hmac = crypto.createHmac('sha256', COOKIE_SECRET).update(payload).digest('hex');
  return payload + '.' + hmac;
}

/**
 * Parse and verify a session cookie value.
 * @param {string} cookieValue
 * @returns {{ username: string, role: string } | null}
 */
function verifySessionCookie(cookieValue) {
  if (typeof cookieValue !== 'string') return null;

  const dotIndex = cookieValue.indexOf('.');
  if (dotIndex === -1) return null;

  const payload = cookieValue.slice(0, dotIndex);
  const signature = cookieValue.slice(dotIndex + 1);

  const expected = Buffer.from(crypto.createHmac('sha256', COOKIE_SECRET).update(payload).digest('hex'));
  const actual = Buffer.from(signature);
  // timingSafeEqual throws on length mismatch — reject first so garbage cookies don't 500
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (typeof data.u !== 'string' || (data.r !== 'admin' && data.r !== 'volunteer')) return null;
    if (typeof data.e !== 'number' || data.e <= Date.now()) return null;
    return { username: data.u, role: data.r };
  } catch {
    return null;
  }
}

/**
 * Build the Set-Cookie header string for login.
 * @param {string} cookieValue
 * @returns {string}
 */
function buildSetCookie(cookieValue) {
  const maxAge = Math.floor(COOKIE_TTL_MS / 1000);
  return `session=${cookieValue}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${COOKIE_SECURE ? '; Secure' : ''}`;
}

/**
 * Build the Set-Cookie header string that clears the session.
 * @returns {string}
 */
function buildClearCookie() {
  return `session=; HttpOnly; SameSite=Strict; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT${COOKIE_SECURE ? '; Secure' : ''}`;
}

/**
 * Validate user input for the add-user operation.
 * @param {*} username
 * @param {*} password
 * @param {*} role
 * @returns {{ error: string } | null} error object if invalid, null if valid
 */
function validateUserInput(username, password, role) {
  if (typeof username !== 'string' || username.trim().length === 0) {
    return { error: 'Username is required' };
  }
  if (typeof password !== 'string' || password.length < 8) {
    return { error: 'Password must be at least 8 characters' };
  }
  if (role !== 'admin' && role !== 'volunteer') {
    return { error: 'Role must be admin or volunteer' };
  }
  return null;
}

module.exports = {
  initUserStore,
  hashPassword,
  hashPasswordAsync,
  authenticate,
  addUser,
  removeUser,
  listUsers,
  createSessionCookie,
  verifySessionCookie,
  buildSetCookie,
  buildClearCookie,
  validateUserInput,
};
