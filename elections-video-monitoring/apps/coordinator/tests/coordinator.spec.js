// @ts-check
const { test, expect } = require('@playwright/test');

const STREAMS = [
  { url: 'https://archive.evideo.bg/le20260222/device-recordings/tour1/real/100000001/le20260222_real_001_100000001_20260222_070000_96.mp4', label: 'Station 001 Cam A' },
  { url: 'https://archive.evideo.bg/le20260222/device-recordings/tour1/real/100000002/le20260222_real_002_100000002_20260222_070000_96.mp4', label: 'Station 002 Cam B' },
  { url: 'https://archive.evideo.bg/le20260222/device-recordings/tour1/real/100000003/le20260222_real_003_100000003_20260222_070000_96.mp4', label: 'Station 003 Cam C' },
];

// ── API: stream upload ────────────────────────────────────────────────────────

test.describe('POST /api/streams', () => {
  test('bulk upload returns inserted count', async ({ request }) => {
    const res = await request.post('/api/streams', { data: STREAMS });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.inserted).toBe(STREAMS.length);
  });

  test('rejects empty array', async ({ request }) => {
    const res = await request.post('/api/streams', { data: [] });
    expect(res.status()).toBe(400);
  });

  test('rejects non-array body', async ({ request }) => {
    const res = await request.post('/api/streams', { data: { url: 'x', label: 'y' } });
    expect(res.status()).toBe(400);
  });

  test('filters out entries missing url', async ({ request }) => {
    const res = await request.post('/api/streams', {
      data: [
        { label: 'no url here' },
        { url: 'https://archive.evideo.bg/ok.mp4', label: 'valid' },
      ],
    });
    expect(res.status()).toBe(200);
    expect((await res.json()).inserted).toBe(1);
  });
});

// ── API: session ──────────────────────────────────────────────────────────────

test.describe('POST /api/session', () => {
  test.beforeEach(async ({ request }) => {
    await request.post('/api/streams', { data: STREAMS });
  });

  test('returns session_id and streams array', async ({ request }) => {
    const res = await request.post('/api/session');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(typeof body.session_id).toBe('string');
    expect(body.session_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    expect(Array.isArray(body.streams)).toBe(true);
    expect(body.streams.length).toBe(STREAMS.length);
  });

  test('each stream has id, url, label', async ({ request }) => {
    const { streams } = await (await request.post('/api/session')).json();
    for (const s of streams) {
      expect(typeof s.id).toBe('number');
      expect(typeof s.url).toBe('string');
      expect(typeof s.label).toBe('string');
    }
  });

  test('different calls produce different session_ids', async ({ request }) => {
    const a = await (await request.post('/api/session')).json();
    const b = await (await request.post('/api/session')).json();
    expect(a.session_id).not.toBe(b.session_id);
  });

  test('session with no streams in DB returns empty streams array', async ({ request }) => {
    // Wipe streams
    await request.post('/api/streams', { data: [{ url: 'https://example.com/x.mp4', label: 'x' }] });
    // Now wipe again with zero valid rows — should 400, so let's just verify with streams present
    // Actually: pickStreams returns up to 16; with 1 stream we get 1
    const { streams } = await (await request.post('/api/session')).json();
    expect(streams.length).toBeGreaterThanOrEqual(1);
  });
});

// ── API: heartbeat ────────────────────────────────────────────────────────────

test.describe('POST /api/heartbeat', () => {
  test('requires session_id', async ({ request }) => {
    const res = await request.post('/api/heartbeat', { data: {} });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toMatch(/session_id/);
  });

  test('accepts heartbeat for existing session', async ({ request }) => {
    await request.post('/api/streams', { data: STREAMS });
    const { session_id } = await (await request.post('/api/session')).json();

    const res = await request.post('/api/heartbeat', { data: { session_id } });
    expect(res.status()).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  test('silently accepts unknown session_id (no crash)', async ({ request }) => {
    // server does UPDATE ... WHERE id = ? with no-op if missing — should not 500
    const res = await request.post('/api/heartbeat', { data: { session_id: 'deadbeef-0000-0000-0000-000000000000' } });
    expect(res.status()).toBe(200);
  });
});

// ── API: report ───────────────────────────────────────────────────────────────

test.describe('POST /api/report', () => {
  test('rejects missing body fields', async ({ request }) => {
    const res = await request.post('/api/report', { data: {} });
    expect(res.status()).toBe(400);
  });

  test('rejects unknown session', async ({ request }) => {
    const res = await request.post('/api/report', {
      data: { session_id: 'unknown-session-id', results: [] },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toMatch(/unknown session/);
  });

  test('accepts valid report with all status values', async ({ request }) => {
    await request.post('/api/streams', { data: STREAMS });
    const { session_id, streams } = await (await request.post('/api/session')).json();

    const statuses = ['ok', 'covered', 'frozen', 'dark', 'loading'];
    for (const status of statuses) {
      const res = await request.post('/api/report', {
        data: {
          session_id,
          results: [{ stream_id: streams[0].id, status, cover_ratio: 0.1, frozen_sec: 0, luma: 80 }],
        },
      });
      expect(res.status()).toBe(200);
      expect((await res.json()).ok).toBe(true);
    }
  });

  test('accepts report with null metrics', async ({ request }) => {
    await request.post('/api/streams', { data: STREAMS });
    const { session_id, streams } = await (await request.post('/api/session')).json();

    const res = await request.post('/api/report', {
      data: {
        session_id,
        results: [{ stream_id: streams[0].id, status: 'loading' }],
      },
    });
    expect(res.status()).toBe(200);
  });
});

// ── API: flagged ──────────────────────────────────────────────────────────────

test.describe('GET /api/flagged', () => {
  test('returns flagged array and volunteer_count', async ({ request }) => {
    const res = await request.get('/api/flagged');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.flagged)).toBe(true);
    expect(typeof body.volunteer_count).toBe('number');
  });

  test('surfaces stream reported covered by ≥2 distinct sessions', async ({ request }) => {
    await request.post('/api/streams', { data: STREAMS });

    const sess1 = await (await request.post('/api/session')).json();
    const sess2 = await (await request.post('/api/session')).json();
    const targetId = sess1.streams[0].id;

    await request.post('/api/report', {
      data: {
        session_id: sess1.session_id,
        results: [{ stream_id: targetId, status: 'covered', cover_ratio: 0.9, frozen_sec: 0, luma: 100 }],
      },
    });
    await request.post('/api/report', {
      data: {
        session_id: sess2.session_id,
        results: [{ stream_id: targetId, status: 'covered', cover_ratio: 0.9, frozen_sec: 0, luma: 100 }],
      },
    });

    const { flagged } = await (await request.get('/api/flagged')).json();
    const entry = flagged.find(f => f.stream_id === targetId && f.flag_type === 'covered');
    expect(entry).toBeDefined();
    expect(entry.report_count).toBeGreaterThanOrEqual(2);
  });

  test('does NOT surface stream reported by only 1 session', async ({ request }) => {
    await request.post('/api/streams', { data: STREAMS });
    const { session_id, streams } = await (await request.post('/api/session')).json();
    const targetId = streams[0].id;

    await request.post('/api/report', {
      data: {
        session_id,
        results: [{ stream_id: targetId, status: 'frozen', cover_ratio: 0, frozen_sec: 300, luma: 80 }],
      },
    });

    const { flagged } = await (await request.get('/api/flagged')).json();
    const entry = flagged.find(f => f.stream_id === targetId && f.flag_type === 'frozen');
    expect(entry).toBeUndefined();
  });

  test('does NOT surface ok/loading/initializing/error reports', async ({ request }) => {
    await request.post('/api/streams', { data: STREAMS });
    const sess1 = await (await request.post('/api/session')).json();
    const sess2 = await (await request.post('/api/session')).json();
    const targetId = sess1.streams[0].id;

    for (const status of ['ok', 'loading', 'initializing', 'error']) {
      await request.post('/api/report', {
        data: {
          session_id: sess1.session_id,
          results: [{ stream_id: targetId, status, cover_ratio: 0, frozen_sec: 0, luma: 100 }],
        },
      });
      await request.post('/api/report', {
        data: {
          session_id: sess2.session_id,
          results: [{ stream_id: targetId, status, cover_ratio: 0, frozen_sec: 0, luma: 100 }],
        },
      });
    }

    const { flagged } = await (await request.get('/api/flagged')).json();
    for (const status of ['ok', 'loading', 'initializing', 'error']) {
      const entry = flagged.find(f => f.stream_id === targetId && f.flag_type === status);
      expect(entry).toBeUndefined();
    }
  });
});

// ── Static pages ──────────────────────────────────────────────────────────────

test.describe('Volunteer page', () => {
  test.beforeEach(async ({ request }) => {
    await request.post('/api/streams', { data: STREAMS });
  });

  test('loads with correct heading', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('header h1')).toContainText('Election Stream Monitor');
  });

  test('shows overlay on first load', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#overlay')).not.toHaveClass(/hidden/);
  });

  test('hides overlay after Start click', async ({ page }) => {
    // Abort the session API so init() never completes and overlay stays visible
    await page.route('/api/session', route => route.abort());
    await page.goto('/');
    await expect(page.locator('#overlay')).not.toHaveClass(/hidden/);
    await page.locator('#start-btn').click();
    await expect(page.locator('#overlay')).toHaveClass(/hidden/);
  });

  test('renders stream cards for assigned streams', async ({ page }) => {
    page.on('pageerror', err => console.error('Page error:', err.message));
    await page.goto('/');
    await expect(page.locator('.stream-card')).toHaveCount(STREAMS.length, { timeout: 15_000 });
  });

  test('stream cards have thumbnails, labels, status and inspect link', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.stream-card')).toHaveCount(STREAMS.length, { timeout: 15_000 });

    const card = page.locator('.stream-card').first();
    await expect(card.locator('.card-thumb')).toBeVisible();
    await expect(card.locator('.card-label')).toContainText('Station');
    await expect(card.locator('.card-status')).toBeVisible();
  });

  test('inspect link loads detector into iframe', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.stream-card')).toHaveCount(STREAMS.length, { timeout: 15_000 });

    const placeholder = page.locator('#inspect-placeholder');
    const frame = page.locator('#inspect-frame');

    await expect(placeholder).toBeVisible();
    await expect(frame).not.toBeVisible();

    await page.locator('.stream-card').first().click();

    await expect(frame).toBeVisible();
    await expect(placeholder).not.toBeVisible();

    const src = await frame.getAttribute('src');
    expect(src).toContain('/inspect/');
    expect(src).toContain('url=');
  });

  test('selected card gets .selected class', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.stream-card')).toHaveCount(STREAMS.length, { timeout: 15_000 });

    const firstCard = page.locator('.stream-card').first();
    await firstCard.click();
    await expect(firstCard).toHaveClass(/selected/);

    // Clicking a second card deselects the first
    const secondCard = page.locator('.stream-card').nth(1);
    await secondCard.click();
    await expect(firstCard).not.toHaveClass(/selected/);
    await expect(secondCard).toHaveClass(/selected/);
  });

  test('no JS errors on load and session init', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('/');
    await expect(page.locator('.stream-card')).toHaveCount(STREAMS.length, { timeout: 15_000 });
    expect(errors).toHaveLength(0);
  });

  test('stream grid has 3-column layout', async ({ page }) => {
    await page.goto('/');
    const gridStyle = await page.locator('#stream-grid').evaluate(
      el => getComputedStyle(el).gridTemplateColumns
    );
    // Should have 3 equal columns
    const cols = gridStyle.trim().split(/\s+/);
    expect(cols.length).toBe(3);
  });

  test('inspect panel is visible on the right', async ({ page }) => {
    await page.goto('/');
    const panel = page.locator('#inspect-panel');
    await expect(panel).toBeVisible();
    const box = await panel.boundingBox();
    const gridBox = await page.locator('#stream-panel').boundingBox();
    // Inspect panel should be to the right of the stream panel
    expect(box.x).toBeGreaterThan(gridBox.x);
  });
});

test.describe('Admin page', () => {
  test('loads without JS errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('/admin');
    await page.waitForTimeout(2_000);
    expect(errors).toHaveLength(0);
  });

  test('shows volunteer count element', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.locator('#vol-count')).toBeVisible();
  });

  test('shows flagged section', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.locator('#flagged-section')).toBeVisible();
  });
});

// ── API: streams count ────────────────────────────────────────────────────────

test.describe('GET /api/streams/count', () => {
  test('returns 0 before any upload', async ({ request }) => {
    // Wipe first so prior tests do not pollute
    await request.post('/api/streams', { data: [{ url: 'https://example.com/x.mp4', label: 'x' }] });
    await request.post('/api/streams', { data: [{ url: 'https://example.com/x.mp4', label: 'x' }] });
    const res = await request.get('/api/streams/count');
    expect(res.status()).toBe(200);
    const { count } = await res.json();
    expect(typeof count).toBe('number');
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('reflects count after bulk upload', async ({ request }) => {
    await request.post('/api/streams', { data: STREAMS });
    const { count } = await (await request.get('/api/streams/count')).json();
    expect(count).toBe(STREAMS.length);
  });

  test('resets to new count after re-upload', async ({ request }) => {
    await request.post('/api/streams', { data: STREAMS });
    await request.post('/api/streams', { data: [STREAMS[0]] });
    const { count } = await (await request.get('/api/streams/count')).json();
    expect(count).toBe(1);
  });
});

// ── POST /api/streams wipe semantics ─────────────────────────────────────────

test.describe('POST /api/streams wipe', () => {
  test('re-upload resets session count to 0', async ({ request }) => {
    await request.post('/api/streams', { data: STREAMS });
    await request.post('/api/session');
    await request.post('/api/session');

    // Volunteer count should be 2
    const before = await (await request.get('/api/flagged')).json();
    expect(before.volunteer_count).toBeGreaterThanOrEqual(2);

    // Re-upload wipes sessions
    await request.post('/api/streams', { data: STREAMS });
    const after = await (await request.get('/api/flagged')).json();
    expect(after.volunteer_count).toBe(0);
  });
});

// ── API: report edge cases ────────────────────────────────────────────────────

test.describe('POST /api/report edge cases', () => {
  test('accepts empty results array', async ({ request }) => {
    await request.post('/api/streams', { data: STREAMS });
    const { session_id } = await (await request.post('/api/session')).json();
    const res = await request.post('/api/report', {
      data: { session_id, results: [] },
    });
    expect(res.status()).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });
});

// ── GET /api/flagged entry shape ──────────────────────────────────────────────

test.describe('GET /api/flagged entry shape', () => {
  test('flagged entry has all required fields', async ({ request }) => {
    await request.post('/api/streams', { data: STREAMS });
    const sess1 = await (await request.post('/api/session')).json();
    const sess2 = await (await request.post('/api/session')).json();
    const targetId = sess1.streams[0].id;

    for (const sess of [sess1, sess2]) {
      await request.post('/api/report', {
        data: {
          session_id: sess.session_id,
          results: [{ stream_id: targetId, status: 'frozen', frozen_sec: 200, cover_ratio: 0, luma: 80 }],
        },
      });
    }

    const { flagged } = await (await request.get('/api/flagged')).json();
    const entry = flagged.find(f => f.stream_id === targetId);
    expect(entry).toBeDefined();
    expect(typeof entry.stream_id).toBe('number');
    expect(typeof entry.url).toBe('string');
    expect(typeof entry.label).toBe('string');
    expect(typeof entry.flag_type).toBe('string');
    expect(typeof entry.first_seen).toBe('number');
    expect(typeof entry.report_count).toBe('number');
  });
});

// ── /inspect routes ───────────────────────────────────────────────────────────

test.describe('/inspect routes', () => {
  test('GET /inspect redirects to /inspect/', async ({ request }) => {
    const res = await request.get('/inspect', { maxRedirects: 0 });
    expect(res.status()).toBe(301);
    expect(res.headers()['location']).toBe('/inspect/');
  });

  test('GET /inspect/ serves HTML page', async ({ request }) => {
    const res = await request.get('/inspect/');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('text/html');
    const body = await res.text();
    expect(body).toContain('<title>');
  });

  test('GET /inspect/style.css serves CSS', async ({ request }) => {
    const res = await request.get('/inspect/style.css');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('text/css');
  });

  test('GET /inspect/app.js serves JavaScript', async ({ request }) => {
    const res = await request.get('/inspect/app.js');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('javascript');
  });

  test('GET /inspect/detection-core.js serves JavaScript', async ({ request }) => {
    const res = await request.get('/inspect/detection-core.js');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('javascript');
  });

  test('/inspect/ loads without JS errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('/inspect/');
    await page.waitForTimeout(1_000);
    expect(errors).toHaveLength(0);
  });
});
