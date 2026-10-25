'use strict';
// Queue of stream rows sent to POST /api/streams/upsert in batches.
// Used by the scraper (--upsert) and scripts/seed.js.
//
// - add(rows) queues rows and sends every full batch of `batchSize` right away.
// - flush() sends what is left (end of an OIK page pass, end of a file).
// - A failed batch is retried with backoff; if it still fails, its rows go back
//   to the queue and the next add()/flush() sends them again. Nothing is dropped.
// - Sends run one at a time, so concurrent callers never send the same row twice.
// - Rows are keyed by section: a newer row for a queued section replaces the old one.
//   The coordinator upsert is idempotent, so resending a row is harmless.

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// Same key the coordinator upserts on; a row without a section is keyed by its URL
const keyOf = (r) => r.section || r.url;

function createBatchUploader({ upsert, batchSize = 30, retries = 3, retryDelayMs = 2000, onSent = () => {}, log = () => {} }) {
  if (!Number.isInteger(batchSize) || batchSize < 1) throw new Error(`batch size must be a positive integer, got ${batchSize}`);
  const queue = new Map();   // section → row, in insertion order
  let chain = Promise.resolve();
  let batches = 0, failures = 0;

  async function sendOne(rows) {
    for (let attempt = 1; ; attempt++) {
      try {
        const result = await upsert(rows);
        batches++;
        onSent(rows, result);
        return true;
      } catch (e) {
        if (attempt > retries) {
          failures++;
          log(`  upsert of ${rows.length} failed after ${attempt} attempts (kept for the next flush): ${e.message}`);
          return false;
        }
        const wait = retryDelayMs * 2 ** (attempt - 1);
        log(`  upsert of ${rows.length} failed (${e.message}); retry ${attempt}/${retries} in ${wait / 1000}s`);
        await sleep(wait);
      }
    }
  }

  // Send batches while the queue holds at least `min` rows; stop at the first batch that fails for good
  function drain(min) {
    const run = chain.then(async () => {
      while (queue.size >= min && queue.size > 0) {
        const rows = [...queue.values()].slice(0, batchSize);
        rows.forEach(r => queue.delete(keyOf(r)));
        if (!(await sendOne(rows))) {
          // Put them back unless a newer row for the same section arrived meanwhile
          const rest = [...queue];
          queue.clear();
          for (const r of rows) queue.set(keyOf(r), r);
          for (const [k, v] of rest) queue.set(k, v);
          return false;
        }
      }
      return true;
    });
    chain = run.catch(() => {});
    return run;
  }

  return {
    add(rows) {
      for (const r of rows) { queue.delete(keyOf(r)); queue.set(keyOf(r), r); }
      return drain(batchSize);
    },
    flush: () => drain(1),
    get pending() { return queue.size; },
    get stats() { return { batches, failures, pending: queue.size }; },
  };
}

module.exports = { createBatchUploader };
