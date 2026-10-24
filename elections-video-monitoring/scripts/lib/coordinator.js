'use strict';
// Admin client for the coordinator API, shared by scripts/seed.js and the scraper's --upsert.
// Base URL: COORDINATOR_URL, else http://localhost:$PORT (default 3000).
// Login: SEED_USER/SEED_PASS, falling back to ADMIN_USER/ADMIN_PASS.

const base = (process.env.COORDINATOR_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');

async function login() {
  const username = process.env.SEED_USER || process.env.ADMIN_USER;
  const password = process.env.SEED_PASS || process.env.ADMIN_PASS;
  if (!username || !password) throw new Error('Set SEED_USER and SEED_PASS (or ADMIN_USER/ADMIN_PASS) to an admin account');
  const res = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error(`Login failed (${res.status})`);
  const { role } = await res.json();
  if (role !== 'admin') throw new Error(`${username} is not an admin`);
  return res.headers.get('set-cookie').split(';')[0];
}

/** Session that logs in lazily and retries once after a 401 (expired cookie). */
function createClient() {
  let cookie = null;
  async function call(method, urlPath, body) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!cookie) cookie = await login();
      const res = await fetch(base + urlPath, {
        method,
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
      });
      if (res.status === 401 && attempt === 0) { cookie = null; continue; }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`${method} ${urlPath} → ${res.status} ${data.error || ''}`.trim());
      return data;
    }
  }
  return {
    base,
    call,
    /** Map of section → assigned_users for every stream the coordinator knows. */
    async assignments() {
      const { streams } = await call('GET', '/api/streams');
      return new Map(streams.map(s => [s.section, s.assigned_users ?? null]));
    },
    upsert: (streams) => call('POST', '/api/streams/upsert', streams),
  };
}

module.exports = { base, login, createClient };
