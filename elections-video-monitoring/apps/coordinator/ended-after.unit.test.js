'use strict';

// The server's ENDED_AFTER parsing must match the page's (volunteer-ended.e2e.test.js has the same table)
const { it } = require('node:test');
const assert = require('node:assert/strict');
const { endedAfterMs } = require('./ended-after');

it('reads an ISO time, HH:MM in Sofia, or defaults to 21:00 Sofia, like the page', () => {
  const cases = [
    ['', '2026-11-01T10:00:00Z', '2026-11-01T19:00:00.000Z'],
    ['', '2026-11-01T23:30:00Z', '2026-11-01T19:00:00.000Z'], // 01:30 Sofia on 2 Nov: still the night of 1 Nov
    ['', '2026-07-01T10:00:00Z', '2026-07-01T18:00:00.000Z'], // summer time
    ['', '2026-10-25T08:00:00Z', '2026-10-25T19:00:00.000Z'], // the day clocks went back
    ['22:30', '2026-11-01T10:00:00Z', '2026-11-01T20:30:00.000Z'],
    [' 22:30 ', '2026-11-01T10:00:00Z', '2026-11-01T20:30:00.000Z'],
    ['2026-11-01T20:00:00+02:00', '2026-11-01T10:00:00Z', '2026-11-01T18:00:00.000Z'],
    ['not a time', '2026-11-01T10:00:00Z', '2026-11-01T19:00:00.000Z'],
    [undefined, '2026-11-01T10:00:00Z', '2026-11-01T19:00:00.000Z'],
  ];
  for (const [cfg, now, want] of cases) {
    assert.equal(new Date(endedAfterMs(cfg, Date.parse(now))).toISOString(), want, `${cfg} at ${now}`);
  }
});
