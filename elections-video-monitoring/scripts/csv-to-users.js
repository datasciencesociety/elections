#!/usr/bin/env node
'use strict';
/**
 * Convert a users CSV (header: username,password,role) into the JSON array
 * shape expected by the coordinator's bulk-user import (/api/users/bulk).
 *
 * Usage:
 *   node scripts/csv-to-users.js scripts/users_700.csv > scripts/users_700.json
 *   node scripts/csv-to-users.js scripts/users_700.csv scripts/users_700.json
 */

const fs = require('fs');

const inFile = process.argv[2];
const outFile = process.argv[3];

if (!inFile) {
  process.stderr.write('Usage: node scripts/csv-to-users.js <in.csv> [out.json]\n');
  process.exit(1);
}

// Minimal RFC-4180-ish CSV parser: handles quoted fields, embedded commas,
// escaped quotes ("") and both \n and \r\n line endings.
function parseCsv(text) {
  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); rows.push(row); field = ''; row = [];
    } else if (c === '\r') {
      // swallow; \n handles the row break
    } else field += c;
  }
  // flush trailing field/row if file lacks a final newline
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

const raw = fs.readFileSync(inFile, 'utf8');
const rows = parseCsv(raw).filter(r => r.length > 1 || (r.length === 1 && r[0].trim() !== ''));

if (rows.length === 0) { process.stderr.write('Error: empty CSV\n'); process.exit(1); }

const header = rows[0].map(h => h.trim());
const iUser = header.indexOf('username');
const iPass = header.indexOf('password');
const iRole = header.indexOf('role');
if (iUser === -1 || iPass === -1 || iRole === -1) {
  process.stderr.write(`Error: CSV must have username,password,role columns. Got: ${header.join(',')}\n`);
  process.exit(1);
}

const users = rows.slice(1).map(r => ({
  username: r[iUser],
  password: r[iPass],
  role: r[iRole],
}));

const json = JSON.stringify(users, null, 2) + '\n';

if (outFile) {
  fs.writeFileSync(outFile, json);
  process.stderr.write(`Wrote ${users.length} users to ${outFile}\n`);
} else {
  process.stdout.write(json);
}
