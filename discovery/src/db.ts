import Database from "better-sqlite3";
import { resolve, dirname } from "node:path";
import { mkdirSync } from "node:fs";

const DB_PATH = resolve(
  process.env.DB_PATH || resolve(import.meta.dirname, "../data/video.db")
);
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);

// WAL so the 1s rebuild job's SELECT doesn't block analyzer metric writes.
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS boxes (
    ip             TEXT PRIMARY KEY,
    capacity       INTEGER NOT NULL DEFAULT 30,
    registered_at  INTEGER NOT NULL,
    last_heartbeat INTEGER NOT NULL,
    draining       INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS sections (
    id    TEXT PRIMARY KEY,
    url   TEXT NOT NULL,
    label TEXT
  );

  CREATE TABLE IF NOT EXISTS assignments (
    section_id  TEXT PRIMARY KEY REFERENCES sections(id) ON DELETE CASCADE,
    box_ip      TEXT NOT NULL REFERENCES boxes(ip) ON DELETE CASCADE,
    assigned_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS metrics (
    section_id   TEXT PRIMARY KEY REFERENCES sections(id) ON DELETE CASCADE,
    status       TEXT NOT NULL,
    luma         REAL,
    motion_diff  REAL,
    cover_ratio  REAL,
    frozen_sec   REAL,
    snapshot_url TEXT,
    box_ip       TEXT,
    reported_at  INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_assignments_box  ON assignments(box_ip);
  CREATE INDEX IF NOT EXISTS idx_metrics_reported ON metrics(reported_at);
  CREATE INDEX IF NOT EXISTS idx_boxes_draining   ON boxes(draining);
  CREATE INDEX IF NOT EXISTS idx_boxes_heartbeat  ON boxes(last_heartbeat);
`);

export const stmt = {
  // boxes
  boxUpsert: db.prepare(
    `INSERT INTO boxes (ip, capacity, registered_at, last_heartbeat, draining)
     VALUES (?, ?, ?, ?, 0)
     ON CONFLICT(ip) DO UPDATE SET capacity = excluded.capacity, last_heartbeat = excluded.last_heartbeat, draining = 0`
  ),
  boxTouch: db.prepare("UPDATE boxes SET last_heartbeat = ? WHERE ip = ?"),
  boxDrain: db.prepare("UPDATE boxes SET draining = 1 WHERE ip = ?"),
  boxDelete: db.prepare("DELETE FROM boxes WHERE ip = ?"),
  boxesAll: db.prepare(
    "SELECT ip, capacity, registered_at, last_heartbeat, draining FROM boxes ORDER BY registered_at"
  ),
  boxesDeadBefore: db.prepare("SELECT ip FROM boxes WHERE last_heartbeat < ?"),

  // sections
  sectionUpsert: db.prepare(
    `INSERT INTO sections (id, url, label) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET url = excluded.url, label = excluded.label`
  ),
  sectionCount: db.prepare("SELECT COUNT(*) AS n FROM sections"),
  sectionsUnassigned: db.prepare(
    `SELECT s.id, s.url, s.label FROM sections s
     LEFT JOIN assignments a ON a.section_id = s.id
     WHERE a.section_id IS NULL`
  ),

  // assignments
  assignPut: db.prepare(
    "INSERT OR REPLACE INTO assignments (section_id, box_ip, assigned_at) VALUES (?, ?, ?)"
  ),
  assignForBox: db.prepare(
    `SELECT s.id, s.url, s.label FROM assignments a
     JOIN sections s ON s.id = a.section_id
     WHERE a.box_ip = ?
     ORDER BY s.id`
  ),
  assignCountByBox: db.prepare(
    `SELECT b.ip, b.capacity, b.draining, COUNT(a.section_id) AS load
     FROM boxes b LEFT JOIN assignments a ON a.box_ip = b.ip
     WHERE b.draining = 0
     GROUP BY b.ip
     ORDER BY load ASC, b.registered_at ASC`
  ),

  // metrics
  metricUpsert: db.prepare(
    `INSERT INTO metrics (section_id, status, luma, motion_diff, cover_ratio, frozen_sec, snapshot_url, box_ip, reported_at)
     VALUES (@section_id, @status, @luma, @motion_diff, @cover_ratio, @frozen_sec, @snapshot_url, @box_ip, @reported_at)
     ON CONFLICT(section_id) DO UPDATE SET
       status       = excluded.status,
       luma         = excluded.luma,
       motion_diff  = excluded.motion_diff,
       cover_ratio  = excluded.cover_ratio,
       frozen_sec   = excluded.frozen_sec,
       snapshot_url = excluded.snapshot_url,
       box_ip       = excluded.box_ip,
       reported_at  = excluded.reported_at`
  ),
  metricsAll: db.prepare(
    `SELECT section_id, status, luma, motion_diff, cover_ratio, frozen_sec, snapshot_url, box_ip, reported_at
     FROM metrics`
  ),
};

export interface MetricRow {
  section_id: string;
  status: string;
  luma: number | null;
  motion_diff: number | null;
  cover_ratio: number | null;
  frozen_sec: number | null;
  snapshot_url: string | null;
  box_ip: string | null;
  reported_at: number;
}

export const writeMetricsBatch = db.transaction((rows: MetricRow[]) => {
  for (const r of rows) stmt.metricUpsert.run(r);
});
