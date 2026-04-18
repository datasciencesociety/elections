# Volunteer Section Picker — Implementation Plan

**Date:** 2026-04-18  
**Status:** Planned  
**Scope:** `apps/coordinator/server.js` + `apps/coordinator/public/volunteer.html`

---

## Context

The current sticky-session mechanism stores raw DB integer stream IDs in `localStorage`.
This is fragile: if the DB is rebuilt (bulk upload/upsert), IDs change and the sticky breaks.
The new flow replaces opaque IDs with a **user-visible section query** that is stored in
`localStorage` instead, and gives volunteers a pre-start section picker backed by a real
search endpoint.

---

## Goals

1. Volunteer picks their section at startup via a single input (ID `013300088` or free text `Петрич`).
2. Sticky session survives a page reload by re-running the same query, not by remembering DB integer IDs.
3. Existing auto-assign-by-count behaviour is preserved as a fallback when no query is provided.

---

## Tasks

### Task 1 — Server: `GET /api/streams/search?q=…`

**File:** `apps/coordinator/server.js`

Add a new route handler `handleStreamsSearch` and wire it before the 404 catch-all.

**Behaviour:**
- Read `q` from the URL query string (trim, reject blank → 400).
- Search `streams` table where `enabled = 1` and:
  - `section LIKE '%' || ? || '%'` OR
  - `label LIKE '%' || ? || '%'`
- Return max 50 results ordered by `section ASC`.
- Response shape: `{ streams: [{ id, section, label }] }`

**Prepared statement to add:**
```js
searchStreams: db.prepare(`
  SELECT id, section, label FROM streams
  WHERE enabled = 1 AND (section LIKE ? OR label LIKE ?)
  ORDER BY section ASC LIMIT 50
`),
```

**Handler:**
```js
function handleStreamsSearch(req, res) {
  const qs  = new URLSearchParams(req.url.split('?')[1] || '');
  const raw = (qs.get('q') || '').trim();
  if (!raw) { json(res, 400, { error: 'q required' }); return; }
  const like = `%${raw}%`;
  const streams = stmt.searchStreams.all(like, like);
  json(res, 200, { streams });
}
```

**Router line to add** (before the 404):
```js
if (req.method === 'GET' && url === '/api/streams/search') {
  handleStreamsSearch(req, res); return;
}
```

---

### Task 2 — Server: accept `section_query` in `POST /api/session`

**File:** `apps/coordinator/server.js`, function `handleSession`

When the client sends `section_query` (string) instead of `stream_ids` (array), resolve
streams by searching the same `section LIKE` / `label LIKE` logic and assign them to the
new session.

**Change in `handleSession`** — add after the `stream_ids` block, before the fallback `pickStreamsForSession()`:
```js
if (!streams || streams.length === 0) {
  if (typeof body.section_query === 'string' && body.section_query.trim()) {
    const like = `%${body.section_query.trim()}%`;
    streams = db.prepare(`
      SELECT id, url, label, section FROM streams
      WHERE enabled = 1 AND (section LIKE ? OR label LIKE ?)
      ORDER BY section ASC LIMIT 40
    `).all(like, like);
  }
}
if (!streams || streams.length === 0) {
  streams = pickStreamsForSession(Date.now() - SESSION_TTL, count);
}
```

---

### Task 3 — `volunteer.html`: replace localStorage keys and init logic

**File:** `apps/coordinator/public/volunteer.html`

#### 3a — Update constants

Remove `LS_STREAMS_KEY`. Add `LS_QUERY_KEY`:
```js
const LS_SESSION_KEY = 'volunteer_session_id';
const LS_QUERY_KEY   = 'volunteer_section_query';  // replaces LS_STREAMS_KEY
```

#### 3b — Update `init()`

Replace the `savedStreams` / `stream_ids` logic with `savedQuery` / `section_query`:
```js
async function init() {
  let data;
  try {
    const requestedCount = parseInt(document.getElementById('stream-count-select').value, 10);
    const savedId    = localStorage.getItem(LS_SESSION_KEY);
    const savedQuery = localStorage.getItem(LS_QUERY_KEY) || '';
    const res = await fetch('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        count: requestedCount,
        ...(savedId    ? { session_id: savedId }       : {}),
        ...(savedQuery ? { section_query: savedQuery } : {}),
      }),
    });
    data = await res.json();
  } catch (e) {
    document.getElementById('loading-msg').textContent = 'Failed to connect. Retrying in 10s…';
    setTimeout(init, 10_000);
    return;
  }

  SESSION_ID = data.session_id;
  localStorage.setItem(LS_SESSION_KEY, SESSION_ID);
  // No longer store stream_ids
  // ...rest unchanged
}
```

#### 3c — Update `reinitSession()`

```js
function reinitSession() {
  localStorage.removeItem(LS_SESSION_KEY); // keep LS_QUERY_KEY so same section is reclaimed
  SESSION_ID = null;
  // ...rest unchanged
}
```

#### 3d — Update count-change handler

```js
document.getElementById('stream-count-select').addEventListener('change', () => {
  localStorage.removeItem(LS_SESSION_KEY);
  localStorage.removeItem(LS_QUERY_KEY);  // was LS_STREAMS_KEY
  reinitSession();
});
```

---

### Task 4 — `volunteer.html`: pre-start section picker UI

**File:** `apps/coordinator/public/volunteer.html`

#### 4a — CSS additions (inside `<style>`)

```css
/* ── Section picker ─────────────────────────────────────────────────────── */
#picker-form { display: flex; flex-direction: column; gap: 12px; align-items: center; width: 100%; max-width: 360px; }
#picker-input {
  width: 100%; padding: 10px 14px; font-size: 15px;
  background: #1a1a1a; color: #e0e0e0; border: 1px solid #444;
  border-radius: 6px; outline: none;
}
#picker-input:focus { border-color: #3b82f6; }
#picker-results {
  width: 100%; max-height: 220px; overflow-y: auto;
  background: #111; border: 1px solid #333; border-radius: 6px;
  list-style: none; padding: 0; margin: 0;
  display: none;
}
#picker-results li {
  padding: 8px 12px; cursor: pointer; font-size: 13px; color: #ccc;
  border-bottom: 1px solid #222;
}
#picker-results li:last-child { border-bottom: none; }
#picker-results li:hover, #picker-results li.active { background: #1e3a5f; color: #fff; }
#picker-results li .sec-code { font-weight: 700; color: #93c5fd; margin-right: 6px; }
#picker-msg { font-size: 12px; color: #888; min-height: 16px; }
#start-btn { padding: 12px 32px; background: #2563eb; color: #fff; border: none; border-radius: 6px; font-size: 16px; cursor: pointer; }
#start-btn:disabled { background: #374151; cursor: default; }
#start-btn:not(:disabled):hover { background: #1d4ed8; }
#picker-skip { font-size: 12px; color: #555; cursor: pointer; margin-top: 4px; }
#picker-skip:hover { color: #888; }
```

#### 4b — Overlay HTML

Replace the existing `#overlay` contents:
```html
<div id="overlay">
  <h2>Stream Monitor</h2>
  <p>Enter your section number or municipality name to find your streams.</p>
  <div id="picker-form">
    <input id="picker-input" type="search" autocomplete="off"
           placeholder="e.g. 013300088 or Петрич" />
    <ul id="picker-results" role="listbox"></ul>
    <div id="picker-msg"></div>
    <button id="start-btn" disabled>Start Monitoring</button>
    <span id="picker-skip">Skip — assign automatically</span>
  </div>
</div>
```

#### 4c — Picker JS

```js
let pickerSelectedQuery = '';

function initPicker() {
  const savedQuery = localStorage.getItem(LS_QUERY_KEY);
  if (savedQuery) {
    // Bypass picker entirely — init() will pass section_query
    document.getElementById('overlay').classList.add('hidden');
    init();
    return;
  }
  setupPickerEvents();
}

function setupPickerEvents() {
  const input    = document.getElementById('picker-input');
  const results  = document.getElementById('picker-results');
  const msg      = document.getElementById('picker-msg');
  const startBtn = document.getElementById('start-btn');
  const skipLink = document.getElementById('picker-skip');
  let debounceTimer = null;

  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    pickerSelectedQuery = '';
    startBtn.disabled = true;
    const q = input.value.trim();
    if (!q) { results.style.display = 'none'; results.innerHTML = ''; msg.textContent = ''; return; }
    debounceTimer = setTimeout(() => runSearch(q), 300);
  });

  async function runSearch(q) {
    msg.textContent = 'Searching…';
    try {
      const r = await fetch(`/api/streams/search?q=${encodeURIComponent(q)}`);
      const data = await r.json();
      msg.textContent = data.streams.length === 0 ? 'No results.' : `${data.streams.length} stream(s) found`;
      renderResults(data.streams);
    } catch { msg.textContent = 'Search failed.'; }
  }

  function renderResults(streams) {
    results.innerHTML = '';
    if (!streams.length) { results.style.display = 'none'; return; }
    for (const s of streams) {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.innerHTML = `<span class="sec-code">${escHtml(s.section)}</span>${escHtml(s.label)}`;
      li.addEventListener('click', () => {
        pickerSelectedQuery = s.section;   // exact section code = best sticky key
        input.value = s.section + ' — ' + s.label;
        results.style.display = 'none';
        msg.textContent = '1 section selected';
        startBtn.disabled = false;
      });
      results.appendChild(li);
    }
    results.style.display = 'block';
  }

  startBtn.addEventListener('click', () => {
    if (!pickerSelectedQuery) return;
    localStorage.setItem(LS_QUERY_KEY, pickerSelectedQuery);
    document.getElementById('overlay').classList.add('hidden');
    init();
  });

  skipLink.addEventListener('click', () => {
    localStorage.removeItem(LS_QUERY_KEY);
    document.getElementById('overlay').classList.add('hidden');
    init();
  });
}
```

#### 4d — Autoplay gate decoupling

The overlay is now owned by the picker. When autoplay is blocked after `init()`, show a
bottom banner instead of re-using `#overlay`:

```js
function showAutoplayBanner() {
  const banner = document.createElement('div');
  banner.id = 'autoplay-banner';
  banner.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:#1e3a5f;color:#fff;'
    + 'text-align:center;padding:12px;font-size:14px;z-index:99;cursor:pointer;';
  banner.textContent = 'Click anywhere to enable audio/video playback';
  banner.addEventListener('click', () => {
    streamStates.forEach(s => s.video.play().catch(() => {}));
    autoplayBlocked = false;
    banner.remove();
  });
  document.body.appendChild(banner);
}
```

In `init()`, replace the autoplay-blocked branch:
```js
if (anyBlocked) {
  showAutoplayBanner();
  autoplayBlocked = true;
} else {
  document.getElementById('overlay').classList.add('hidden');
}
```

Remove the old `#start-btn` click listener that called `video.play()`.

#### 4e — Boot sequence

Replace the bottom `init()` call:
```js
// ── Boot ─────────────────────────────────────────────────────────────────────
initPicker();
```

---

## Out of scope

- Multi-section selection (volunteer monitors more than one section).
- Server-side auth / coordinator-assigned links (option B from brainstorm).
- i18n of picker strings — covered separately in `docs/i18n-plan.md`.

---

## Acceptance criteria

- [ ] `GET /api/streams/search?q=013300088` returns the matching stream(s)
- [ ] `GET /api/streams/search?q=Петрич` returns streams whose label contains that word
- [ ] `GET /api/streams/search` (no `q`) returns 400
- [ ] First visit: picker overlay appears, typing shows results, selecting a section and clicking Start loads that section's streams
- [ ] Page reload: picker is bypassed, same section streams are loaded immediately via saved query
- [ ] Changing stream count clears the saved query and forces the picker again on next load
- [ ] Skip link: picker dismissed, auto-assign by count proceeds
- [ ] Autoplay blocked: bottom banner appears, not the picker overlay
