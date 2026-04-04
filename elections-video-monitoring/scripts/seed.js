#!/usr/bin/env node
'use strict';
/**
 * Seed the coordinator with a pre-scraped streams JSON file.
 *
 * Usage:
 *   node scripts/seed.js                                      # default file
 *   node scripts/seed.js apps/scraper/streams_tour1_live.json # custom file
 *   PORT=4000 node scripts/seed.js                           # custom port
 */

const fs   = require('fs');
const path = require('path');

const file = process.argv[2] || path.join('apps', 'scraper', 'streams_tour1_live.json');
const port = process.env.PORT || 3000;
const url  = `http://localhost:${port}/api/streams`;

const force = process.argv.includes('--force');
const body  = fs.readFileSync(file, 'utf8');
const count = JSON.parse(body).length;

async function run() {
  const countRes = await fetch(`http://localhost:${port}/api/streams/count`);
  const { count: existing } = await countRes.json();

  if (existing > 0 && !force) {
    process.stderr.write(
      `Abort: coordinator already has ${existing} stream(s) and collected data.\n` +
      `Re-seeding will wipe all sessions and reports.\n` +
      `Run with --force to proceed: node scripts/seed.js ${file} --force\n`
    );
    process.exit(1);
  }

  process.stdout.write(`Seeding ${count} stream(s) from ${file} → ${url}\n`);
  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  const d = await res.json();
  process.stdout.write(`Done: ${JSON.stringify(d)}\n`);
}

run().catch(e => { process.stderr.write(`Error: ${e.message}\n`); process.exit(1); });
