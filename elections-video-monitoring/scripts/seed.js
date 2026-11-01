#!/usr/bin/env node
'use strict';
/**
 * Seed the coordinator with one or more pre-scraped streams JSON files.
 *
 * Usage:
 *   node scripts/seed.js                                                          # the 4 dev test videos (local coordinator only)
 *   node scripts/seed.js apps/scraper/streams_le20260222_tour1_live.json          # one file
 *   node scripts/seed.js file1.json file2.json                                    # multiple files
 *   node scripts/seed.js --replace                                                # wipe & replace (first file only)
 *   PORT=4000 node scripts/seed.js                                                # custom port
 *   COORDINATOR_URL=http://host:3000 node scripts/seed.js file.json               # remote coordinator
 *   node scripts/seed.js file.json --stubs                                        # sections without URLs: cards say
 *                                                                                 # "Stream not yet started" until a scrape fills them
 *   node scripts/seed.js file.json --batch-size=30                                # upsert 30 rows per request, retrying a failed one
 *   node scripts/seed.js file.json --stubs --replace --force --batch-size=500     # wipe & replace in batches: the first 500 rows
 *                                                                                 # replace, the rest are upserted 500 at a time
 *
 * Use --batch-size with --replace for any remote coordinator: nginx refuses a body over 1 MB (413),
 * and 11,732 stubs are 2.25 MB. A batched replace ends with the same streams, contacts and links
 * as one replace request; it checks the file before wiping anything.
 *
 * Needs an admin login: SEED_USER/SEED_PASS (falls back to ADMIN_USER/ADMIN_PASS).
 */

const fs   = require('fs');
const path = require('path');

const args    = process.argv.slice(2).filter(a => !a.startsWith('--'));
const flags   = new Set(process.argv.slice(2).filter(a => a.startsWith('--')));
// Old archive recordings that always play: for local dev, never for the live site
const DEV_STREAMS = path.join(__dirname, 'dev-streams.json');
const files   = args.length > 0 ? args : [DEV_STREAMS];
const { base, login, readJson, createClient } = require('./lib/coordinator');
const { createBatchUploader } = require('./lib/batch-upload');
const replace = flags.has('--replace') || flags.has('--force');
const stubs   = flags.has('--stubs');
const batchArg = [...flags].find(f => f.startsWith('--batch-size='));
const batchSize = batchArg ? parseInt(batchArg.split('=')[1], 10) : 0;
if (batchArg && !(batchSize >= 1)) { process.stderr.write('--batch-size must be a positive integer\n'); process.exit(1); }

const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base);
if (!isLocal && !stubs && files.some(f => path.resolve(f) === DEV_STREAMS)) {
  process.stderr.write(`Abort: ${path.basename(DEV_STREAMS)} holds dev test videos; only a local coordinator takes them (add --stubs to send its sections without URLs)\n`);
  process.exit(1);
}

// Body for one file; --stubs keeps section and label and drops the URL
function readStreams(file) {
  const streams = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!stubs) return streams;
  return streams.map(s => ({ ...s, section: s.section || (s.url.match(/\/([0-9]{9})\//) || [])[1], url: '' }));
}

// Section a row is stored under: the coordinator's rule (server.js txBulkUpload/txUpsertStreams)
const sectionOf = (s) => s.section || (String(s.url || '').match(/\/([0-9]{9})\//) || [])[1] || String(s.label);

/**
 * Rows for the upsert part of a batched replace, shaped so the upsert stores what one replace
 * request would have stored (server.js txBulkUpload vs txUpsertStreams):
 * - replace stores assigned_users '' as NULL, upsert keeps ''           → send `|| null`
 * - replace stores String(label), upsert drops a row without a string   → send numbers as strings
 * Returns an error message instead when the file holds rows the two treat differently:
 * - a row without a label: replace stores it, upsert drops it
 * - a section twice: replace fails as a whole (unique section), upsert keeps the last row
 */
function upsertRowsAfterReplace(streams) {
  const unlabelled = streams.filter(s => !(typeof s.label === 'number' || (typeof s.label === 'string' && s.label.trim())));
  if (unlabelled.length) return `${unlabelled.length} row(s) have no label (first: ${JSON.stringify(unlabelled[0]).slice(0, 120)})`;
  const seen = new Set(), dup = new Set();
  for (const s of streams) { const k = sectionOf(s); (seen.has(k) ? dup : seen).add(k); }
  if (dup.size) return `${dup.size} section(s) appear more than once (first: ${[...dup][0]})`;
  return { rows: streams.map(s => ({ ...s, label: String(s.label), assigned_users: s.assigned_users || null })) };
}

/** Upsert rows in batches, retrying a failed batch; returns how many rows were left unsent. */
async function upsertInBatches(rows) {
  const client = createClient();
  const uploader = createBatchUploader({
    upsert: (batch) => client.upsert(batch), batchSize,
    log: (m) => process.stderr.write(m + '\n'),
    onSent: (batch, d) => process.stdout.write(`  ${batch.length} → ${JSON.stringify(d)}\n`),
  });
  // A batch that still fails after its retries stops the run; flush() would only retry it again
  if (await uploader.add(rows)) await uploader.flush();
  return uploader.pending;
}

async function run() {
  const cookie  = await login();
  const headers = { 'Content-Type': 'application/json', Cookie: cookie };
  if (replace) {
    // Destructive mode: only the first file, with confirmation guard
    const file    = files[0];
    const streams = readStreams(file);
    const countRes = await fetch(`${base}/api/streams/count`);
    const { count: existing } = await readJson(countRes, 'GET /api/streams/count');
    if (existing > 0 && !flags.has('--force')) {
      process.stderr.write(
        `Abort: coordinator already has ${existing} stream(s) and collected data.\n` +
        `Re-seeding will wipe all sessions and reports.\n` +
        `Run with --force to proceed: node scripts/seed.js ${file} --force\n`
      );
      process.exit(1);
    }
    // --batch-size: the first batch goes in the replace request, the rest are upserted after it
    const first = batchSize ? streams.slice(0, batchSize) : streams;
    let rest = [];
    if (batchSize && streams.length > batchSize) {
      const r = upsertRowsAfterReplace(streams);
      if (typeof r === 'string') throw new Error(`${file}: ${r}; a batched replace would not match one replace request. Nothing was changed.`);
      rest = r.rows.slice(batchSize);
    }
    const url = `${base}/api/streams`;
    process.stdout.write(`Replacing with ${streams.length} ${stubs ? 'stub' : 'stream'}(s) from ${file} → ${url}` +
      (rest.length ? ` (${first.length} in the replace request, ${rest.length} upserted in batches of ${batchSize})` : '') + '\n');
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(first) });
    const d = await readJson(res, `POST ${url}`);
    process.stdout.write(`Done: ${JSON.stringify(d)}\n`);
    if (rest.length) {
      const pending = await upsertInBatches(rest);
      if (pending) {
        throw new Error(`${pending} row(s) from ${file} not sent after the replace, so the coordinator holds only part of the file. ` +
          `Rerun the same command, or keep what is loaded and upsert the file: ` +
          `node scripts/seed.js ${file}${stubs ? ' --stubs' : ''} --batch-size=${batchSize}`);
      }
      process.stdout.write(`Done: ${streams.length} row(s) sent (${first.length} replaced, ${rest.length} upserted)\n`);
    }
  } else if (batchSize) {
    for (const file of files) {
      const streams = readStreams(file);
      process.stdout.write(`Upserting ${streams.length} ${stubs ? 'stub' : 'section'}(s) from ${file} → ${base}/api/streams/upsert in batches of ${batchSize}\n`);
      const pending = await upsertInBatches(streams);
      if (pending) throw new Error(`${pending} row(s) from ${file} not sent; rerun (upsert is idempotent)`);
    }
  } else {
    const url = `${base}/api/streams/upsert`;
    for (const file of files) {
      const streams = readStreams(file);
      const body    = JSON.stringify(streams);
      process.stdout.write(`Upserting ${streams.length} ${stubs ? 'stub' : 'section'}(s) from ${file} → ${url}\n`);
      const res = await fetch(url, { method: 'POST', headers, body });
      const d = await readJson(res, `POST ${url}`);
      process.stdout.write(`Done: ${JSON.stringify(d)}\n`);
    }
  }
}

run().catch(e => { process.stderr.write(`Error: ${e.message}\n`); process.exit(1); });
