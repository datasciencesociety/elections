'use strict';

// When a stream may be marked ended (ENDED_AFTER). Mirrors endedAfterMs() in public/volunteer.html,
// which reads the same value from window.ENDED_AFTER; keep the two in step (ended-after.unit.test.js
// runs the page's own test table against this copy).
// cfg: an ISO date-time with offset, or "HH:MM" in Sofia. Empty or invalid: 21:00 Sofia.
// "Today" before 06:00 Sofia is the previous day, so the night count keeps the evening's limit.

function sofiaParts(ms) {
  const p = {};
  for (const { type, value } of new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Sofia', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(ms)) p[type] = Number(value);
  return p;
}

function sofiaToMs(y, m, d, hh, mm) {
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  let ms = wall;
  for (let i = 0; i < 2; i++) {
    const p = sofiaParts(ms);
    ms = wall - (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000);
  }
  return ms;
}

function endedAfterMs(cfgRaw, now = Date.now()) {
  const cfg = typeof cfgRaw === 'string' ? cfgRaw.trim() : '';
  let hh = 21, mm = 0;
  const hm = /^(\d{1,2}):(\d{2})$/.exec(cfg);
  if (hm) { hh = Number(hm[1]); mm = Number(hm[2]); }
  else if (cfg) {
    const ms = Date.parse(cfg);
    if (!Number.isNaN(ms)) return ms;
  }
  const p = sofiaParts(now);
  return sofiaToMs(p.year, p.month, p.day - (p.hour < 6 ? 1 : 0), hh, mm);
}

module.exports = { endedAfterMs };
