#!/usr/bin/env node
'use strict';
// Loads the fraud-fight priority per section into the coordinator ("Добави секция" order).
//
// Input: the risk sheet exported as CSV (kept outside the repo). Header row starts with
// "Номер на секция"; column K = priority (higher = watch first), M = 2026 section ID,
// A = 2024 section number (used when M is empty). Two rows for one section: the higher wins.
// --eyes=<priority_list.csv>: rows "section,watchers needed" (no header; the leading zero may be
// missing). A section in that list but not in the sheet gets risk 0.
//
// Usage:
//   COORDINATOR_URL=https://<live-domain> SEED_USER=… SEED_PASS=… node scripts/load-risk.js risk.csv
//   node scripts/load-risk.js risk.csv --eyes=priority_list.csv [--dry-run]   # --dry-run sends nothing

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

function eyesBySection(text) {
  const eyes = new Map();
  for (const [sec, n] of parseCsv(text.replace(/^\uFEFF/, ''))) {
    const section = String(sec || '').trim().padStart(9, '0');
    const count = Number(n);
    if (/^\d{9}$/.test(section) && Number.isInteger(count) && count >= 1) eyes.set(section, count);
  }
  return eyes;
}

async function main() {
  const file = process.argv.slice(2).find(a => !a.startsWith('--'));
  if (!file) { console.error('Usage: node scripts/load-risk.js <risk.csv> [--dry-run]'); process.exit(1); }
  const { rows, skipped } = riskRows(fs.readFileSync(file, 'utf8'));
  const eyesArg = process.argv.find(a => a.startsWith('--eyes='));
  if (eyesArg) {
    const eyes = eyesBySection(fs.readFileSync(eyesArg.slice('--eyes='.length), 'utf8'));
    const known = new Set(rows.map(r => r.section));
    for (const r of rows) if (eyes.has(r.section)) r.eyes = eyes.get(r.section);
    let added = 0;
    for (const [section, n] of eyes) if (!known.has(section)) { rows.push({ section, risk: 0, eyes: n }); added++; }
    const dist = {};
    for (const r of rows) if (r.eyes) dist[r.eyes] = (dist[r.eyes] || 0) + 1;
    console.log(`eyes for ${eyes.size} sections (${added} not in the sheet): ${JSON.stringify(dist)}`);
  }
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

module.exports = { parseCsv, riskRows, eyesBySection };
