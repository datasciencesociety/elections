#!/usr/bin/env node
'use strict';

/**
 * Convert video-sections-distribution CSV into coordinator JSON config.
 *
 * CSV columns per section X (X = 1..4):
 *   "Секция X Номер"
 *   "Секция X Адрес"
 *   "Секция X Член на СИК"
 *   "Секция X Член на СИК Телефон"
 *   "Секция X Упълномощен представител"
 *   "Секция X Упълномощен представител Телефон"
 * Plus: "Username", "Password"
 *
 * Output: JSON array of { section, url, label, assigned_users, contacts }
 *
 * Usage:
 *   node scripts/csv-to-sections.js <input.csv> [output.json]
 *   node scripts/csv-to-sections.js C:\Users\...\video-sections-distribution.csv sections.json
 */

const fs = require('fs');
const path = require('path');

const inputPath = process.argv[2];
const outputPath = process.argv[3] || 'sections-output.json';

if (!inputPath) {
  console.error('Usage: node csv-to-sections.js <input.csv> [output.json]');
  process.exit(1);
}

const raw = fs.readFileSync(path.resolve(inputPath), 'utf-8');
const lines = raw.split(/\r?\n/).filter(l => l.trim());

// Parse CSV (handles quoted fields with commas inside)
function parseCSVLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { current += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { fields.push(current.trim()); current = ''; }
      else { current += ch; }
    }
  }
  fields.push(current.trim());
  return fields;
}

const headers = parseCSVLine(lines[0]);
const rows = lines.slice(1).map(parseCSVLine);

// Build column index map
function colIndex(name) {
  const idx = headers.findIndex(h => h.toLowerCase() === name.toLowerCase());
  return idx;
}

// URLs left empty — merge with scraper output later using merge-sections.js
const EMPTY_URL = '';

// Values that mean "no data" — treat as empty
const NONE_VALUES = new Set([
  'няма информация за упълномощен представител',
  'няма информация за член на сик',
  'няма телефон',
  'няма',
  'н/д',
  '-',
  '',
]);

function isNone(val) {
  return !val || NONE_VALUES.has(val.toLowerCase().trim());
}

// Accumulate sections: key = section number, value = { label, assigned_users[], contacts[] }
const sectionsMap = new Map();

function getOrCreate(sectionNum, address) {
  if (!sectionsMap.has(sectionNum)) {
    sectionsMap.set(sectionNum, {
      section: sectionNum,
      url: EMPTY_URL,
      label: address || `Секция ${sectionNum}`,
      assigned_users: [],
      contacts: [],
    });
  }
  const entry = sectionsMap.get(sectionNum);
  // Update label if we get a better address
  if (address && entry.label === `Секция ${sectionNum}`) {
    entry.label = address;
  }
  return entry;
}

// Also collect users for bulk upload
const usersSet = new Map();

for (const row of rows) {
  const username = (row[colIndex('Username')] || '').trim();
  const password = (row[colIndex('Password')] || '').trim();

  if (username && password) {
    usersSet.set(username, { username, password, role: 'volunteer' });
  }

  for (let x = 1; x <= 4; x++) {
    const numCol = colIndex(`Секция ${x} Номер`);
    const addrCol = colIndex(`Секция ${x} Адрес`);
    const sikNameCol = colIndex(`Секция ${x} Член на СИК`);
    const sikPhoneCol = colIndex(`Секция ${x} Член на СИК Телефон`);
    const repNameCol = colIndex(`Секция ${x} Упълномощен представител`);
    const repPhoneCol = colIndex(`Секция ${x} Упълномощен представител Телефон`);

    const sectionNum = numCol >= 0 ? (row[numCol] || '').trim() : '';
    if (!sectionNum) continue; // No section assigned in this slot

    const address = addrCol >= 0 ? (row[addrCol] || '').trim() : '';
    const sikName = sikNameCol >= 0 ? (row[sikNameCol] || '').trim() : '';
    const sikPhone = sikPhoneCol >= 0 ? (row[sikPhoneCol] || '').trim() : '';
    const repName = repNameCol >= 0 ? (row[repNameCol] || '').trim() : '';
    const repPhone = repPhoneCol >= 0 ? (row[repPhoneCol] || '').trim() : '';

    const entry = getOrCreate(sectionNum, address);

    // Add this user as assigned
    if (username && !entry.assigned_users.includes(username)) {
      entry.assigned_users.push(username);
    }

    // Add SIK member as contact
    if (sikName && !isNone(sikName)) {
      const phone = isNone(sikPhone) ? null : sikPhone;
      const exists = entry.contacts.some(c => c.name === sikName && c.phone === phone);
      if (!exists) {
        entry.contacts.push({ name: sikName, phone, role: 'Член на СИК' });
      }
    }

    // Add representative as contact
    if (repName && !isNone(repName)) {
      const phone = isNone(repPhone) ? null : repPhone;
      const exists = entry.contacts.some(c => c.name === repName && c.phone === phone);
      if (!exists) {
        entry.contacts.push({ name: repName, phone, role: 'Упълномощен представител' });
      }
    }
  }
}

// Build output
const sections = [...sectionsMap.values()].map(s => ({
  section: s.section,
  url: s.url,
  label: s.label,
  assigned_users: s.assigned_users.join(',') || undefined,
  contacts: s.contacts.length > 0 ? s.contacts : undefined,
}));

// Sort by section number
sections.sort((a, b) => a.section.localeCompare(b.section));

fs.writeFileSync(path.resolve(outputPath), JSON.stringify(sections, null, 2), 'utf-8');
console.log(`Wrote ${sections.length} sections to ${outputPath}`);

// Also write users file for bulk upload
const users = [...usersSet.values()];
if (users.length > 0) {
  const usersPath = outputPath.replace(/\.json$/, '-users.json');
  fs.writeFileSync(path.resolve(usersPath), JSON.stringify(users, null, 2), 'utf-8');
  console.log(`Wrote ${users.length} users to ${usersPath}`);
}
