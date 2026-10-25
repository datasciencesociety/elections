#!/usr/bin/env node
'use strict';
// Loads the fraud-fight priority per section into the coordinator ("Добави секция" order).
//
// Input: the risk sheet exported as CSV (kept outside the repo). Header row starts with
// "Номер на секция"; column K = priority (higher = watch first), M = 2026 section ID,
// A = 2024 section number (used when M is empty). Two rows for one section: the higher wins.
//
// Usage:
//   COORDINATOR_URL=https://<live-domain> SEED_USER=… SEED_PASS=… node scripts/load-risk.js risk.csv
//   node scripts/load-risk.js risk.csv --dry-run     # print counts, send nothing

const fs = require('fs');
const { base, login } = require('./lib/coordinator');

const COL = { section2024: 0, risk: 10, section2026: 12 };

// RFC 4180: quoted fields may hold commas, quotes ("") and newlines
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function riskRows(text) {
  const rows = parseCsv(text.replace(/^﻿/, ''));
  const header = rows.findIndex(r => (r[COL.section2024] || '').trim() === 'Номер на секция');
  if (header < 0) throw new Error('header row "Номер на секция" not found');
  const bySection = new Map();
  let skipped = 0;
  for (const r of rows.slice(header + 1)) {
    const m = (r[COL.section2026] || '').trim();
    const section = /^\d{9}$/.test(m) ? m : (r[COL.section2024] || '').trim();
    const risk = Number(String(r[COL.risk] || '').replace(',', '.'));
    if (!/^\d{9}$/.test(section) || !Number.isFinite(risk) || r[COL.risk] === '') { skipped++; continue; }
    if (!bySection.has(section) || bySection.get(section) < risk) bySection.set(section, risk);
  }
  return { rows: [...bySection].map(([section, risk]) => ({ section, risk })), skipped };
}

async function main() {
  const file = process.argv.slice(2).find(a => !a.startsWith('--'));
  if (!file) { console.error('Usage: node scripts/load-risk.js <risk.csv> [--dry-run]'); process.exit(1); }
  const { rows, skipped } = riskRows(fs.readFileSync(file, 'utf8'));
  const top = [...rows].sort((a, b) => b.risk - a.risk).slice(0, 3).map(r => `${r.section}=${r.risk}`).join(', ');
  console.log(`${rows.length} sections, ${skipped} rows skipped; highest: ${top}`);
  if (process.argv.includes('--dry-run')) return;
  const cookie = await login();
  const res = await fetch(`${base}/api/streams/risk`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(rows),
  });
  console.log(`→ ${res.status} ${await res.text()}`);
  if (!res.ok) process.exit(1);
}

if (require.main === module) main().catch(e => { console.error(e.message); process.exit(1); });

module.exports = { parseCsv, riskRows };
