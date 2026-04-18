#!/usr/bin/env node
'use strict';
/**
 * Seed the coordinator with one or more pre-scraped streams JSON files.
 *
 * Usage:
 *   node scripts/seed.js                                                          # upsert both sample files (default)
 *   node scripts/seed.js apps/scraper/streams_le20260222_tour1_live.json          # one file
 *   node scripts/seed.js file1.json file2.json                                    # multiple files
 *   node scripts/seed.js --replace                                                # wipe & replace (first file only)
 *   PORT=4000 node scripts/seed.js                                                # custom port
 */

const fs   = require('fs');
const path = require('path');

const args    = process.argv.slice(2).filter(a => !a.startsWith('--'));
const flags   = new Set(process.argv.slice(2).filter(a => a.startsWith('--')));
const files   = args.length > 0 ? args : [
  path.join('apps', 'scraper', 'streams_le20260222_tour1_live.json'),
  path.join('apps', 'scraper', 'streams_le20250615_tour1_live.json'),
];
const port    = process.env.PORT || 3000;
const replace = flags.has('--replace') || flags.has('--force');

async function run() {
  if (replace) {
    // Destructive mode: only the first file, with confirmation guard
    const file  = files[0];
    const body  = fs.readFileSync(file, 'utf8');
    const count = JSON.parse(body).length;
    const countRes = await fetch(`http://localhost:${port}/api/streams/count`);
    const { count: existing } = await countRes.json();
    if (existing > 0 && !flags.has('--force')) {
      process.stderr.write(
        `Abort: coordinator already has ${existing} stream(s) and collected data.\n` +
        `Re-seeding will wipe all sessions and reports.\n` +
        `Run with --force to proceed: node scripts/seed.js ${file} --force\n`
      );
      process.exit(1);
    }
    const url = `http://localhost:${port}/api/streams`;
    process.stdout.write(`Replacing with ${count} stream(s) from ${file} → ${url}\n`);
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    const d = await res.json();
    process.stdout.write(`Done: ${JSON.stringify(d)}\n`);
  } else {
    const url = `http://localhost:${port}/api/streams/upsert`;
    for (const file of files) {
      const body  = fs.readFileSync(file, 'utf8');
      const count = JSON.parse(body).length;
      process.stdout.write(`Upserting ${count} section(s) from ${file} → ${url}\n`);
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      const d = await res.json();
      process.stdout.write(`Done: ${JSON.stringify(d)}\n`);
    }
  }
}

run().catch(e => { process.stderr.write(`Error: ${e.message}\n`); process.exit(1); });
