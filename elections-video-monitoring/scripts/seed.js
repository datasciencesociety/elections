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
const { base, login } = require('./lib/coordinator');
const replace = flags.has('--replace') || flags.has('--force');
const stubs   = flags.has('--stubs');

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

async function run() {
  const cookie  = await login();
  const headers = { 'Content-Type': 'application/json', Cookie: cookie };
  if (replace) {
    // Destructive mode: only the first file, with confirmation guard
    const file    = files[0];
    const streams = readStreams(file);
    const body    = JSON.stringify(streams);
    const count   = streams.length;
    const countRes = await fetch(`${base}/api/streams/count`);
    const { count: existing } = await countRes.json();
    if (existing > 0 && !flags.has('--force')) {
      process.stderr.write(
        `Abort: coordinator already has ${existing} stream(s) and collected data.\n` +
        `Re-seeding will wipe all sessions and reports.\n` +
        `Run with --force to proceed: node scripts/seed.js ${file} --force\n`
      );
      process.exit(1);
    }
    const url = `${base}/api/streams`;
    process.stdout.write(`Replacing with ${count} ${stubs ? 'stub' : 'stream'}(s) from ${file} → ${url}\n`);
    const res = await fetch(url, { method: 'POST', headers, body });
    const d = await res.json();
    process.stdout.write(`Done: ${JSON.stringify(d)}\n`);
  } else {
    const url = `${base}/api/streams/upsert`;
    for (const file of files) {
      const streams = readStreams(file);
      const body    = JSON.stringify(streams);
      process.stdout.write(`Upserting ${streams.length} ${stubs ? 'stub' : 'section'}(s) from ${file} → ${url}\n`);
      const res = await fetch(url, { method: 'POST', headers, body });
      const d = await res.json();
      process.stdout.write(`Done: ${JSON.stringify(d)}\n`);
    }
  }
}

run().catch(e => { process.stderr.write(`Error: ${e.message}\n`); process.exit(1); });
