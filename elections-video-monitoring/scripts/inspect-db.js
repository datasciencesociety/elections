#!/usr/bin/env node
'use strict';
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const dbPath = path.join(__dirname, '..', 'apps', 'coordinator', 'data', 'streams.db');
const db = new DatabaseSync(dbPath);

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
console.log('TABLES:', tables.map(t => t.name).join(', '));
console.log();

for (const t of tables) {
  const count = db.prepare('SELECT COUNT(*) AS c FROM ' + t.name).get();
  console.log(`--- ${t.name} (${count.c} rows) ---`);
  const rows = db.prepare('SELECT * FROM ' + t.name + ' LIMIT 3').all();
  if (rows.length) console.log(JSON.stringify(rows, null, 2));
  else console.log('(empty)');
  console.log();
}

// Show streams with their contacts (if any)
const streamsWithContacts = db.prepare(`
  SELECT s.id, s.section, s.label, c.name AS contact_name, c.phone, c.role
  FROM streams s
  JOIN stream_contacts sc ON sc.stream_id = s.id
  JOIN contacts c ON c.id = sc.contact_id
  ORDER BY s.section, c.name
  LIMIT 20
`).all();
if (streamsWithContacts.length) {
  console.log('--- streams with contacts (up to 20) ---');
  console.log(JSON.stringify(streamsWithContacts, null, 2));
  console.log();
}

db.close();
