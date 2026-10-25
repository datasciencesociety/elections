#!/usr/bin/env node
'use strict';

/**
 * Merge two section JSON files:
 *   - base: from csv-to-sections.js (has assigned_users, contacts, but empty URLs)
 *   - scraper: from the scraper (has section, url, label)
 *
 * Matching is done by section number. The merge:
 *   - Takes url and label from the scraper file
 *   - Takes assigned_users and contacts from the base file
 *   - Sections only in scraper → included with just url/label (no assignments)
 *   - Sections only in base (no scraper match) → included but with empty url
 *
 * Usage:
 *   node scripts/merge-sections.js <base.json> <scraper.json> [output.json]
 *
 * Example:
 *   node scripts/merge-sections.js sections.json apps/scraper/streams_le20260222_tour1_live.json merged.json
 */

const fs = require('fs');
const path = require('path');

const basePath = process.argv[2];
const scraperPath = process.argv[3];
const outputPath = process.argv[4] || 'merged-sections.json';

if (!basePath || !scraperPath) {
  console.error('Usage: node merge-sections.js <base.json> <scraper.json> [output.json]');
  process.exit(1);
}

const base = JSON.parse(fs.readFileSync(path.resolve(basePath), 'utf-8'));
const scraper = JSON.parse(fs.readFileSync(path.resolve(scraperPath), 'utf-8'));

// Index base by section number
const baseMap = new Map();
for (const entry of base) {
  baseMap.set(entry.section, entry);
}

// Index scraper by section number
const scraperMap = new Map();
for (const entry of scraper) {
  scraperMap.set(entry.section, entry);
}

const merged = [];
const matched = new Set();

// Start with all scraper sections (they have URLs)
for (const s of scraper) {
  const b = baseMap.get(s.section);
  const entry = {
    section: s.section,
    url: s.url,
    label: s.label || (b ? b.label : s.section),
  };
  if (b) {
    if (b.assigned_users) entry.assigned_users = b.assigned_users;
    if (b.contacts && b.contacts.length > 0) entry.contacts = b.contacts;
    matched.add(s.section);
  }
  merged.push(entry);
}

// Add base-only sections (no scraper match — no URL yet)
let unmatched = 0;
for (const b of base) {
  if (matched.has(b.section)) continue;
  const entry = {
    section: b.section,
    url: '',
    label: b.label,
  };
  if (b.assigned_users) entry.assigned_users = b.assigned_users;
  if (b.contacts && b.contacts.length > 0) entry.contacts = b.contacts;
  merged.push(entry);
  unmatched++;
}

merged.sort((a, b) => a.section.localeCompare(b.section));

fs.writeFileSync(path.resolve(outputPath), JSON.stringify(merged, null, 2), 'utf-8');

console.log(`Merged: ${merged.length} sections total`);
console.log(`  ${matched.size} matched (have URL + assignments)`);
console.log(`  ${scraper.length - matched.size} scraper-only (URL but no assignments)`);
console.log(`  ${unmatched} base-only (assignments but no URL yet)`);
console.log(`Written to ${outputPath}`);
