#!/usr/bin/env node
'use strict';

/**
 * Convert high-risk sections CSV into coordinator JSON config.
 *
 * CSV structure:
 *   Row 1: generic Column1..ColumnN headers (skip)
 *   Row 2: real headers: Номер на секция, ЕКАТТЕ, Област, Община, Населено място, Адрес,
 *          Имена на член на СИК (окончателно), Телефон на член на СИК (окончателно),
 *          Имена на упълномощен представител (окончателно), Телефон на упълномощен представител (окончателно), ...
 *   Row 3+: data
 *
 * Output: JSON array of { section, url: "", label, contacts }
 *
 * Usage:
 *   node scripts/csv-highrisk-to-sections.js <input.csv> [output.json]
 */

const fs = require('fs');
const path = require('path');

const inputPath = process.argv[2];
const outputPath = process.argv[3] || 'highrisk-sections.json';

if (!inputPath) {
  console.error('Usage: node csv-highrisk-to-sections.js <input.csv> [output.json]');
  process.exit(1);
}

const raw = fs.readFileSync(path.resolve(inputPath), 'utf-8');
const lines = raw.split(/\r?\n/).filter(l => l.trim());

// Parse CSV (handles quoted fields with commas and escaped quotes)
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

// Auto-detect header row: find the row containing "Номер на секция"
let headerRowIdx = -1;
for (let i = 0; i < Math.min(lines.length, 5); i++) {
  const parsed = parseCSVLine(lines[i]);
  if (parsed.some(h => h.toLowerCase().trim() === 'номер на секция')) {
    headerRowIdx = i;
    break;
  }
}
if (headerRowIdx < 0) {
  console.error('Could not find header row containing "Номер на секция" in first 5 lines.');
  process.exit(1);
}

const realHeaders = parseCSVLine(lines[headerRowIdx]);
const dataRows = lines.slice(headerRowIdx + 1).map(parseCSVLine);

// Build column index from real headers
function colIndex(name) {
  return realHeaders.findIndex(h => h.toLowerCase().trim() === name.toLowerCase().trim());
}

const COL_SECTION   = colIndex('Номер на секция');
const COL_OBLAST    = colIndex('Област');
const COL_OBSHTINA  = colIndex('Община');
const COL_TOWN      = colIndex('Населено място');
const COL_ADDRESS   = colIndex('Адрес');
const COL_SIK_NAME  = colIndex('Имена на член на СИК (окончателно)');
const COL_SIK_PHONE = colIndex('Телефон на член на СИК (окончателно)');
const COL_REP_NAME  = colIndex('Имена на упълномощен представител (окончателно)');
const COL_REP_PHONE = colIndex('Телефон на упълномощен представител (окончателно)');

if (COL_SECTION < 0) {
  console.error('Could not find "Номер на секция" column. Headers found:', realHeaders.slice(0, 10));
  process.exit(1);
}

// Values that mean "no data"
const NONE_VALUES = new Set([
  'няма информация за упълномощен представител',
  'няма информация за член на сик',
  'няма телефон',
  'няма',
  'н/д',
  '#n/a',
  '-',
  '',
]);
function isNone(val) {
  return !val || NONE_VALUES.has(val.toLowerCase().trim());
}

const sectionsMap = new Map();

for (const row of dataRows) {
  const sectionNum = (row[COL_SECTION] || '').trim();
  if (!sectionNum) continue;

  const address = COL_ADDRESS >= 0 ? (row[COL_ADDRESS] || '').trim() : '';
  const town = COL_TOWN >= 0 ? (row[COL_TOWN] || '').trim() : '';
  const label = address || town || `Секция ${sectionNum}`;

  if (!sectionsMap.has(sectionNum)) {
    sectionsMap.set(sectionNum, {
      section: sectionNum,
      url: '',
      label,
      contacts: [],
    });
  }

  const entry = sectionsMap.get(sectionNum);

  // SIK member
  const sikName = COL_SIK_NAME >= 0 ? (row[COL_SIK_NAME] || '').trim() : '';
  const sikPhone = COL_SIK_PHONE >= 0 ? (row[COL_SIK_PHONE] || '').trim() : '';
  if (!isNone(sikName)) {
    const phone = isNone(sikPhone) ? null : sikPhone;
    const exists = entry.contacts.some(c => c.name === sikName && c.phone === phone);
    if (!exists) {
      entry.contacts.push({ name: sikName, phone, role: 'Член на СИК' });
    }
  }

  // Representative
  const repName = COL_REP_NAME >= 0 ? (row[COL_REP_NAME] || '').trim() : '';
  const repPhone = COL_REP_PHONE >= 0 ? (row[COL_REP_PHONE] || '').trim() : '';
  if (!isNone(repName)) {
    const phone = isNone(repPhone) ? null : repPhone;
    const exists = entry.contacts.some(c => c.name === repName && c.phone === phone);
    if (!exists) {
      entry.contacts.push({ name: repName, phone, role: 'Упълномощен представител' });
    }
  }
}

// Build output
const sections = [...sectionsMap.values()].map(s => ({
  section: s.section,
  url: '',
  label: s.label,
  ...(s.contacts.length > 0 ? { contacts: s.contacts } : {}),
}));

sections.sort((a, b) => a.section.localeCompare(b.section));

fs.writeFileSync(path.resolve(outputPath), JSON.stringify(sections, null, 2), 'utf-8');
console.log(`Wrote ${sections.length} high-risk sections to ${outputPath}`);
