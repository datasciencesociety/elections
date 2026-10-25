'use strict';
// node --test scripts/lib/batch-upload.test.js

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createBatchUploader } = require('./batch-upload');

const rows = (from, n) => Array.from({ length: n }, (_, i) => ({ section: String(from + i), url: `http://127.0.0.1/${from + i}.m3u8`, label: 'x' }));

describe('createBatchUploader', () => {
  it('sends every full batch at once and the rest on flush', async () => {
    const calls = [];
    const up = createBatchUploader({ upsert: async (r) => { calls.push(r.length); return {}; }, batchSize: 30 });
    await up.add(rows(0, 10));
    assert.deepEqual(calls, []);
    await up.add(rows(10, 65));          // 75 queued → two batches of 30, 15 wait
    assert.deepEqual(calls, [30, 30]);
    assert.equal(up.pending, 15);
    await up.flush();
    assert.deepEqual(calls, [30, 30, 15]);
    assert.equal(up.pending, 0);
  });

  it('keeps the newest row per section', async () => {
    const sent = [];
    const up = createBatchUploader({ upsert: async (r) => { sent.push(...r); }, batchSize: 30 });
    await up.add([{ section: '1', url: 'http://a/old', label: 'x' }]);
    await up.add([{ section: '1', url: 'http://a/new', label: 'x' }]);
    await up.flush();
    assert.deepEqual(sent.map(r => r.url), ['http://a/new']);
  });

  it('retries a failed batch and reports it sent once', async () => {
    let fails = 2;
    const sentBatches = [];
    const up = createBatchUploader({
      upsert: async () => { if (fails-- > 0) throw new Error('502'); return { inserted: 3 }; },
      batchSize: 3, retries: 3, retryDelayMs: 1,
      onSent: (r) => sentBatches.push(r.length),
    });
    await up.add(rows(0, 3));
    assert.deepEqual(sentBatches, [3]);
    assert.equal(up.pending, 0);
  });

  it('keeps a batch that fails for good and sends it on the next flush, in order', async () => {
    let down = true;
    const sent = [];
    const up = createBatchUploader({
      upsert: async (r) => { if (down) throw new Error('ECONNREFUSED'); sent.push(...r.map(x => x.section)); },
      batchSize: 2, retries: 1, retryDelayMs: 1,
    });
    assert.equal(await up.add(rows(0, 3)), false);
    assert.equal(up.pending, 3);
    assert.equal(up.stats.failures, 1);
    down = false;
    assert.equal(await up.flush(), true);
    assert.deepEqual(sent, ['0', '1', '2']);
  });

  it('a newer row queued during a failed send wins over the failed one', async () => {
    let release, down = true;
    const sent = [];
    const up = createBatchUploader({
      upsert: async (r) => {
        if (down) { await new Promise(res => { release = res; }); throw new Error('timeout'); }
        sent.push(...r);
      },
      batchSize: 1, retries: 0, retryDelayMs: 1,
    });
    const first = up.add([{ section: '1', url: 'http://a/old', label: 'x' }]);
    await new Promise(r => setImmediate(r));
    const second = up.add([{ section: '1', url: 'http://a/new', label: 'x' }]);
    release();
    await first;
    down = false;
    await second;
    await up.flush();
    assert.deepEqual(sent.map(r => r.url), ['http://a/new']);
  });

  it('concurrent adds never send a row twice', async () => {
    const seen = new Map();
    const up = createBatchUploader({
      upsert: async (r) => { await new Promise(res => setTimeout(res, 2)); r.forEach(x => seen.set(x.section, (seen.get(x.section) || 0) + 1)); },
      batchSize: 30,
    });
    await Promise.all([up.add(rows(0, 40)), up.add(rows(40, 40)), up.add(rows(80, 40))]);
    await up.flush();
    assert.equal(seen.size, 120);
    assert.ok([...seen.values()].every(n => n === 1));
  });

  it('rejects a bad batch size', () => {
    assert.throws(() => createBatchUploader({ upsert: async () => {}, batchSize: 0 }));
  });
});
